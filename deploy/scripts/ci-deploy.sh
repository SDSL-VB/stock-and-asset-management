#!/usr/bin/env bash
# The only thing GitHub Actions' SSH key may run for SD-SIM. Installed as a
# forced command in ~deploy/.ssh/authorized_keys (docs/deploy-droplet.md): the
# workflow's request arrives in SSH_ORIGINAL_COMMAND and is checked here before
# it reaches deploy.sh. stdin carries the GitHub user and the job's short-lived
# token for reading the images.
set -euo pipefail

read -r action commit extra <<<"${SSH_ORIGINAL_COMMAND:-}"
case "$action" in
  deploy|rollback|status) ;;
  *) echo "not allowed: '${SSH_ORIGINAL_COMMAND:-}'" >&2; exit 1 ;;
esac
if [[ -n ${commit:-} && ! $commit =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "not a commit hash: $commit" >&2; exit 1
fi
[[ -z ${extra:-} ]] || { echo "unexpected arguments" >&2; exit 1; }

if [[ $action != status ]]; then
  GHCR_USER="" GHCR_TOKEN=""
  read -r -t 5 GHCR_USER || true
  read -r -t 5 GHCR_TOKEN || true
  export GHCR_USER GHCR_TOKEN
fi

exec /opt/sim/deploy/scripts/deploy.sh "$action" ${commit:-}
