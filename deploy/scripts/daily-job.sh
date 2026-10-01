#!/usr/bin/env bash
# The daily job (low stock, late orders, morning mails) — what Vercel Cron did.
# Called from inside the app container, so /api/cron is never exposed to the
# internet; the bills Caddy refuses that path from outside.
#
#   crontab -e      (as deploy)
#   0 8 * * * /opt/sim/deploy/scripts/daily-job.sh >> /opt/sim/backups/daily-job.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/../.."
docker compose -f deploy/docker-compose.yml --env-file .env.production exec -T sim-app \
  node -e "fetch('http://127.0.0.1:3000/api/cron/daily',{headers:{authorization:'Bearer '+process.env.CRON_SECRET}}).then(async r=>{console.log(new Date().toISOString(),r.status,await r.text());process.exit(r.ok?0:1)})"
