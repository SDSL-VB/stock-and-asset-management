#!/usr/bin/env bash
# Database backup, ENCRYPTED before it is written anywhere. Each dump is
# encrypted with `age` to BACKUP_AGE_RECIPIENT, a public key whose private half
# lives only on your own computer — so a copy of a backup, on the droplet or in
# Spaces, is unreadable without it. Keeps the 14 newest locally and, when the
# Spaces settings are present, uploads each one under sim-backups/.
#
# Includes the audit log (the transaction history).
#
#   crontab -e      (as deploy)
#   30 2 * * * cd /opt/sim && ./deploy/scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/../.."
ENV_FILE=.env.production
set -a; . "./$ENV_FILE"; set +a
: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT (see docs/deploy-droplet.md)}"
command -v age >/dev/null || { echo "age is not installed: sudo apt install age" >&2; exit 1; }

umask 077
mkdir -p backups
FILE="backups/sim-$(date +%Y%m%d-%H%M%S).sql.gz.age"
TMP=$(mktemp backups/.dump.XXXXXX)
trap 'rm -f "$TMP"' EXIT

# To a file first: in a pipe, a failed pg_dump would still leave an "ok" file
docker compose -f deploy/docker-compose.yml --env-file "$ENV_FILE" exec -T \
  -e PGPASSWORD="$DB_SUPERUSER_PASSWORD" sim-db \
  pg_dump -h 127.0.0.1 -U "${DB_SUPERUSER:-sim_admin}" sim > "$TMP"
[[ -s $TMP ]] || { echo "empty dump" >&2; exit 1; }
gzip -c "$TMP" | age -r "$BACKUP_AGE_RECIPIENT" > "$FILE"

if [[ -n ${SPACES_BUCKET:-} ]]; then
  docker run --rm -v "$PWD/backups:/backups:ro" \
    -e AWS_ACCESS_KEY_ID="$SPACES_KEY" -e AWS_SECRET_ACCESS_KEY="$SPACES_SECRET" \
    -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    amazon/aws-cli --endpoint-url "$SPACES_ENDPOINT" --region "$SPACES_REGION" \
    s3 cp "/$FILE" "s3://$SPACES_BUCKET/sim-$FILE" --acl private
fi

ls -1t backups/sim-*.sql.gz.age | tail -n +15 | xargs -r rm --
echo "$(date) backup ok: $FILE"
