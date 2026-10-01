#!/usr/bin/env bash
# Deploys a commit of master on the droplet, or goes back to an earlier one.
# The same flow as the bills app's deploy.sh; see docs/deploy-droplet.md.
#
#   deploy/scripts/deploy.sh deploy <commit>     back up, migrate, switch over
#   deploy/scripts/deploy.sh rollback [commit]   back to an earlier release
#   deploy/scripts/deploy.sh status              current release and history
#
# GitHub Actions builds each commit into two images on ghcr.io (sim-app and
# sim-tools, tagged with the commit). This only downloads them. After every
# migration it re-applies deploy/db/audit.sql, so new tables are logged too.
#
# A rollback changes the code only; migrations are never undone. Restore the
# dump taken just before the deploy if a migration went wrong.
#
# Everything is inside functions and the last line exits: git checkout rewrites
# this file mid-run, and bash reads a script as it goes.
set -euo pipefail

ENV_FILE=.env.production
COMPOSE_FILE=deploy/docker-compose.yml
RELEASES=releases.log
KEEP=5
BRANCH=master

log() { echo "[$(date '+%F %T')] $*"; }
die() { log "ERROR: $*"; exit 1; }
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
superuser_psql() {
  # Inside the container, as the superuser; the password never leaves this machine
  compose exec -T -e PGPASSWORD="$DB_SUPERUSER_PASSWORD" sim-db \
    psql -h 127.0.0.1 -U "${DB_SUPERUSER:-sim_admin}" -d sim -v ON_ERROR_STOP=1 -q "$@"
}

registry() {
  if [[ -n ${REGISTRY:-} ]]; then echo "$REGISTRY"; return; fi
  local owner
  owner=$(git remote get-url origin | sed -E 's#(\.git)?$##; s#.*[:/]([^/]+)/[^/]+$#\1#')
  echo "ghcr.io/${owner,,}"
}

current_release() { [[ -s $RELEASES ]] && tail -n 1 "$RELEASES" | awk '{print $3}' || true; }
previous_release() {
  local cur; cur=$(current_release)
  [[ -s $RELEASES ]] || return 0
  awk '{print $3}' "$RELEASES" | tac | awk -v cur="$cur" '$0 != cur { print; exit }'
}
resolve() { git rev-parse --verify --quiet "$1^{commit}" || die "unknown commit: $1 (is it pushed to GitHub?)"; }
has_image() { docker image inspect "$1" >/dev/null 2>&1; }

# fetch <app|tools> <commit>: make sim-<name>:<commit> available locally
fetch() {
  local name="sim-$1" sha=$2
  has_image "$name:$sha" && return
  [[ -n ${GHCR_TOKEN:-} ]] || die "$name:${sha:0:7} is not on this droplet. Run it from GitHub: Actions → Deploy → Run workflow"
  local remote cfg
  remote="$(registry)/$name:$sha"
  cfg=$(mktemp -d)   # a throwaway login: no registry password stays on the droplet
  log "downloading $name ${sha:0:7}"
  if ! printf '%s' "$GHCR_TOKEN" | DOCKER_CONFIG=$cfg docker login "${remote%%/*}" -u "${GHCR_USER:-github}" --password-stdin >/dev/null 2>&1 ||
     ! DOCKER_CONFIG=$cfg docker pull --quiet "$remote" >/dev/null; then
    rm -rf "$cfg"; die "could not download $remote (did the GitHub build for this commit finish?)"
  fi
  rm -rf "$cfg"
  docker tag "$remote" "$name:$sha"
  docker image rm "$remote" >/dev/null
}

switch_to() {
  docker tag "sim-app:$1" sim-app:current
  compose up -d --no-deps --force-recreate --wait --wait-timeout 120 sim-app
}

prune() {
  local keep; keep=$( (awk '{print $3}' "$RELEASES" | tac | awk '!seen[$0]++' | head -n "$KEEP") 2>/dev/null || true)
  local img tag
  for img in sim-app sim-tools; do
    docker image ls "$img" --format '{{.Tag}}' | while read -r tag; do
      [[ $tag == current ]] && continue
      if [[ $img == sim-tools ]]; then [[ $tag == "$(current_release)" ]] && continue
      else grep -qx "$tag" <<<"$keep" && continue; fi
      docker image rm "$img:$tag" >/dev/null || true
    done
  done
  docker image prune -f >/dev/null
}

deploy() {
  [[ -n ${1:-} ]] || die "usage: deploy.sh deploy <commit>"
  git fetch --quiet origin
  local sha; sha=$(resolve "$1")
  git merge-base --is-ancestor "$sha" "origin/$BRANCH" || die "${sha:0:7} is not on $BRANCH"
  local prev; prev=$(current_release)
  [[ $sha == "$prev" ]] && { log "${sha:0:7} is already live"; exit 0; }

  fetch app "$sha"
  fetch tools "$sha"
  git checkout --quiet --detach "$sha"

  docker network inspect bills_default >/dev/null 2>&1 || die "the bills app's network is missing — is bills running?"
  compose up -d --wait sim-db
  if [[ -n $prev ]]; then
    log "backing up the database before migrating"
    ./deploy/scripts/backup.sh
  fi

  log "applying migrations"
  docker tag "sim-tools:$sha" sim-tools:current
  compose run --rm sim-tools
  log "recording transactions on every table"
  superuser_psql -f /sim-db-scripts/audit.sql

  log "switching to ${sha:0:7}"
  if ! switch_to "$sha"; then
    compose logs --tail 50 sim-app || true
    if [[ -n $prev ]]; then
      log "new release is unhealthy: going back to ${prev:0:7}"
      git checkout --quiet --detach "$prev"
      fetch app "$prev"
      switch_to "$prev"
      echo "$(date '+%F %T') $prev rollback" >> "$RELEASES"
      log "back on ${prev:0:7}. If the new migrations broke the data, restore the newest dump in backups/"
    fi
    die "deploy of ${sha:0:7} failed"
  fi
  echo "$(date '+%F %T') $sha deploy" >> "$RELEASES"
  prune
  log "live: ${sha:0:7} $(git log -1 --format=%s "$sha")"
}

rollback() {
  git fetch --quiet origin || true
  local sha
  if [[ -n ${1:-} ]]; then sha=$(resolve "$1"); else sha=$(previous_release); fi
  [[ -n $sha ]] || die "no earlier release to go back to"
  [[ $sha == "$(current_release)" ]] && { log "${sha:0:7} is already live"; exit 0; }
  log "rolling back to ${sha:0:7} (code only; the database stays as it is)"
  fetch app "$sha"
  git checkout --quiet --detach "$sha"
  switch_to "$sha" || { compose logs --tail 50 sim-app || true; die "${sha:0:7} did not come up healthy"; }
  echo "$(date '+%F %T') $sha rollback" >> "$RELEASES"
  log "live: ${sha:0:7} $(git log -1 --format=%s "$sha")"
}

status() {
  local cur; cur=$(current_release)
  echo "live: ${cur:-none}"
  [[ -n $cur ]] && git log -1 --format='      %h %s (%an, %ar)' "$cur"
  echo; echo "history (newest first):"
  [[ -s $RELEASES ]] && tac "$RELEASES" | head -n 15 | while read -r d t sha action; do
    local here="from GitHub"; has_image "sim-app:$sha" && here="on droplet"
    printf '  %s %s  %s  %-8s  %-11s  %s\n' "$d" "$t" "${sha:0:7}" "$action" "$here" "$(git log -1 --format=%s "$sha" 2>/dev/null)"
  done
  compose ps
}

main() {
  cd "$(dirname "$0")/../.."
  [[ -f $ENV_FILE ]] || die "$ENV_FILE is missing (see docs/deploy-droplet.md)"
  set -a; . "./$ENV_FILE"; set +a
  exec 9>"/tmp/sim-deploy.lock"
  flock -n 9 || die "another SD-SIM deploy is running"
  case "${1:-}" in
    deploy)   deploy "${2:-}" ;;
    rollback) rollback "${2:-}" ;;
    status)   status ;;
    *) die "usage: deploy.sh deploy <commit> | rollback [commit] | status" ;;
  esac
}

main "$@"; exit
