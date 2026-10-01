# Hosting SD-SIM on the bills droplet

SD-SIM runs on the same DigitalOcean droplet as the bills app, behind the bills
Caddy, with its own Postgres. Everything here lives in `deploy/`.

```
Browser ─HTTPS─> Caddy (bills project) ─┬─> bills app ─> bills Postgres
                                        └─> sim-app (read-only) ─private network─> sim-db
```

Why it is shaped like this:

- **Its own database server.** The bills app connects to its Postgres as a
  superuser, so sharing it would let a fault in one app read the other's data.
- **Nothing can reach the database.** `sim-db` publishes no port and sits on an
  `internal` Docker network with no route in or out.
- **Three logins** (`deploy/db/init/01-roles.sh`):

  | Login | Used by | Can |
  | --- | --- | --- |
  | `sim_admin` | you, over SSH | everything; the only login that reads the transaction log |
  | `sim_owner` | migrations and `prisma/fresh-start.ts` | owns the schema |
  | `sim_app` | the running app | read and write rows, nothing else |

- **Every change recorded.** `deploy/db/audit.sql` puts triggers on every table
  that write each insert, update and delete, with old and new values, into
  `audit.log`. Only the superuser can read the log. deploy.sh re-runs the script
  after each migration, so new tables are covered too.

## Setting it up

The steps follow the bills runbook's conventions (user `deploy`, Docker Compose,
GitHub Actions builds, no builds on the droplet).

1. **Resize** the droplet to 2 GB, choosing CPU and RAM only.
2. **DNS:** add an A record `sim` pointing at the droplet IP.
3. **Your computer:** create the backup key with
   `age-keygen -o ~/sim-keys/sim-backup-key.txt`. Keep the private file
   offline; its public `age1…` line goes in `BACKUP_AGE_RECIPIENT`.
4. **Secrets:** generate six with `openssl rand -hex 32`:
   `DB_SUPERUSER_PASSWORD`, `SIM_OWNER_PASSWORD`, `SIM_APP_PASSWORD`,
   `NEXTAUTH_SECRET`, `PASSWORD_ENCRYPTION_KEY`, `CRON_SECRET`.
5. **Blob store:** create a new **private** Vercel Blob store and copy its
   `BLOB_READ_WRITE_TOKEN`.
6. **Droplet code:**
   1. Add a read-only deploy key for the repository and an
      `~/.ssh/config` host `github-sim` that uses it.
   2. Clone into `/opt/sim` and check out `master`.
   3. Install `age` with `apt install age`.
   4. `mkdir -m 700 backups`.
7. **Settings:** run `cp deploy/env.production.example .env.production`,
   then `chmod 600 .env.production`, and fill it in.
8. **CI key:** add a forced command for it in `~deploy/.ssh/authorized_keys`:

       command="/opt/sim/deploy/scripts/ci-deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA… sim-ci

9. **Caddy:** paste `deploy/caddy/sim.caddy` into the bills repository's
   `Caddyfile` and push the bills repository. Its deploy reloads Caddy.
10. **GitHub secrets** in this repository: `DEPLOY_HOST`,
    `DEPLOY_KNOWN_HOSTS` (from `ssh-keyscan -t ed25519 <ip>`) and
    `SIM_DEPLOY_SSH_KEY`.
11. **First deploy:** Actions → Deploy → Run workflow (deploy). On its first
    start, `sim-db` creates the logins and the transaction log.
12. **Fresh start:** this creates every role and only Super Admin and Admin,
    with random passwords printed once. It refuses a database that already
    has accounts.

        docker compose -f deploy/docker-compose.yml --env-file .env.production \
          run --rm sim-tools npx tsx prisma/fresh-start.ts

13. **Cron**, as `deploy`:

        45 2 * * * cd /opt/sim && ./deploy/scripts/backup.sh >> backups/backup.log 2>&1
        0 8 * * * /opt/sim/deploy/scripts/daily-job.sh >> /opt/sim/backups/daily-job.log 2>&1

## Everyday commands

```bash
cd /opt/sim && set -a && . ./.env.production && set +a
alias simc='docker compose -f deploy/docker-compose.yml --env-file .env.production'

deploy/scripts/deploy.sh status             # what is live
deploy/scripts/deploy.sh rollback           # previous release (code only)

# the transaction log (superuser only)
simc exec -e PGPASSWORD="$DB_SUPERUSER_PASSWORD" sim-db psql -h 127.0.0.1 -U sim_admin -d sim \
  -c "select at, db_user, table_name, op, row_id from audit.log order by id desc limit 50"
```

## Restoring a backup

1. On your computer, decrypt the backup:
   `age -d -i sim-backup-key.txt <file>.sql.gz.age | gunzip > restore.sql`
2. Copy `restore.sql` to the droplet.
3. Run `simc stop sim-app`.
4. As `sim_admin`, drop and recreate the database:
   `DROP DATABASE sim WITH (FORCE); CREATE DATABASE sim;`
5. Restore its access rules:
   `REVOKE ALL ON DATABASE sim FROM PUBLIC;` and
   `GRANT CONNECT, TEMPORARY ON DATABASE sim TO sim_owner, sim_app;`
6. Load the dump: `psql -d sim -v ON_ERROR_STOP=1 < restore.sql`.
7. Shred `restore.sql`, then run `simc start sim-app`.

## Notes

- `deploy/caddy/sim.caddy` refuses `/api/health` and `/api/cron` from outside.
  The container health check and `daily-job.sh` call them from inside the
  container.
- Backups are encrypted with `age` before they are written. Without the private
  key on your computer, a copy of one is unreadable.
- The Dockerfile installs `openssl` in every stage. Without it, Prisma picks an
  engine that needs libssl 1.1, which Alpine doesn't ship, and every query fails.
