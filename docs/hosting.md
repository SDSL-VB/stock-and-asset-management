# Hosting it

How to put this system somewhere real so it can be tested properly. Written for
a **test instance used by your own team**, not for a public product.

What the app needs, and why:

| Need | Why | If you get it wrong |
| --- | --- | --- |
| PostgreSQL | the whole data model | nothing runs |
| Somewhere to put uploaded files | invoices go to Vercel Blob, so a persistent disk is no longer required. The browser sends them there **directly** — see below | uploading errors with a missing-token message; nothing else is affected |
| A long-running Node process | ordinary server rendering, and Server-Sent Events later | works without it today; blocks live updates later |
| One small instance | about a dozen people | — |

---

## Why package.json pins next-auth's nodemailer

`next-auth` lists `nodemailer` as an OPTIONAL peer and accepts only `^7 || ^8`.
This app runs nodemailer 10, because every version up to and including 9.1.0
carries five advisories — among them arbitrary file read and SSRF through the
message-level `raw` option (GHSA-p6gq-j5cr-w38f), and a quadratic-time address
parser that makes a denial of service cheap (GHSA-2x7j-588g-ccc2).

npm refuses that combination and a deploy dies at `npm install`:

    npm error ERESOLVE could not resolve
    npm error Conflicting peer dependency: nodemailer@8.0.11

So package.json says:

    "overrides": { "next-auth": { "nodemailer": "$nodemailer" } }

which tells npm to give next-auth whatever nodemailer the root project uses.
Nothing is actually shimmed: next-auth wants nodemailer only for its Email
sign-in provider, and this app does not use it — sign-in is Credentials
(src/auth.ts) and the mail this app sends is its own
(src/lib/notifications/mail.ts). The peer is optional and unused, so satisfying
it on paper costs nothing.

Prefer this to `legacy-peer-deps=true` in an .npmrc: that switch turns peer
checking off for every package forever, and would hide the next real conflict.
Revisit when next-auth 5 leaves beta and widens the range.

## The short version

```bash
cp .env.example .env.production          # then fill it in — see below
docker compose --env-file .env.production up -d --build
docker compose exec app npx prisma migrate deploy
docker compose exec app npx prisma db seed     # ONLY on an empty database
```

Then open `http://<host>:3000`. `docker-compose.yml` gives you the app, a
Postgres, and named volumes for both the database and the uploads.

---

## What was added for this

| File | Does |
| --- | --- |
| `next.config.ts` | `output: "standalone"` (a self-contained server bundle) and a `noindex` header on every response |
| `Dockerfile` | three-stage build; copies `public/`, `.next/static` and the Prisma CLI, which standalone does not include |
| `.dockerignore` | keeps `.env`, `public/uploads` and the docs out of the image |
| `docker-compose.yml` | app + Postgres + volumes, for a local production-shaped run or a whole small deployment |
| `.env.example` | every variable, with what happens if you leave it out |
| `src/lib/attachments.ts` | `toDownloadUrl` — the HTML `download` attribute is ignored cross-origin, so blob URLs get `?download=1` |
| `src/app/api/health/route.ts` | `/api/health`, which checks the database rather than just the port |
| `src/app/robots.ts` | keeps the system out of search engines |
| `src/auth.ts` | eight failed sign-ins for one address buys a fifteen-minute lockout |

---

## Choosing a host

**Recommended — a container on one small machine.** Railway, Render, Fly.io, or
a €5 Hetzner box running the compose file. All of them give you a persistent
volume, which is the thing that matters. On a plain VPS put Caddy in front for
automatic HTTPS.

**Vercel, free, is the other route — and the quickest one to a test URL.**
Uploads no longer touch the filesystem, so the objection that used to stand here
is gone: `src/app/api/upload/route.ts` writes to Vercel Blob and stores the
returned https URL, and `deleteAttachment` in `src/lib/actions/stock.ts` deletes
the blob. Pair it with a free Neon Postgres. See "Deploying free on Vercel"
below.

Whichever you pick:

* Run `npx prisma migrate deploy` on each release. **Never `db push`** — it can
  drop columns to make the schema match.
* `npm run db:seed` **wipes the database first**. It is for an empty one only.

---

## Deploying free on Vercel

Three free accounts, no card: Vercel (Hobby) runs the app, Neon runs Postgres,
Vercel Blob holds uploaded documents. Good enough for a dozen people testing
flows; not a production posture.

### 1. The database

Create a Neon project. It hands you **two** connection strings, and they are not
interchangeable:

* the **pooled** one (its host contains `-pooler`) — for the running app. Each
  serverless request opens its own connection, and a plain connection would run
  the database out of them within minutes.
* the **direct** one — for migrations, which need a real session.

Point your local `.env` at the **direct** string and set the schema up from your
own machine:

```bash
npx prisma migrate deploy     # creates the tables
npm run db:seed               # ONLY on an empty database — it wipes first
```

### 2. The project

Import the GitHub repository at vercel.com. It detects Next.js; the defaults are
correct, and `postinstall` runs `prisma generate` on every build. `next.config.ts`
turns `output: "standalone"` off automatically when `VERCEL` is set, since Vercel
packages the routes itself.

Then, in Storage, create a **Blob** store and connect it to the project. That is
what puts `BLOB_READ_WRITE_TOKEN` into the environment; you never paste it.

### 3. The environment variables

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon's **pooled** string with `?pgbouncer=true&connection_limit=10` appended. **Not `connection_limit=1`**, the usual serverless advice: pages here fan out heavily inside one request (the superadmin dashboard fires 13 fetchers at once), and a single connection makes them queue until Prisma gives up with `P2024`. Measured against Neon: 60 concurrent queries took 1.7s at 10, and failed outright at 1 |
| `NEXTAUTH_SECRET` | a fresh one — `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `NEXTAUTH_URL` | **do not set it.** next-auth rewrites every request's origin to this value, so a `localhost` one copied from development sends anyone who signs in to their own machine |
| `AUTH_TRUST_HOST` | optional here — `@auth/core` turns `trustHost` on by itself when it sees Vercel's own `VERCEL` variable |
| `BLOB_READ_WRITE_TOKEN` | added for you when the Blob store is connected |
| `PASSWORD_ENCRYPTION_KEY` | **leave unset.** See the warning below |

Redeploy after adding them — a Vercel build bakes the environment in, so
variables added afterwards do not reach a deployment that already exists.

### Put the functions next to the database

Vercel Hobby runs functions in `iad1` (Washington DC) unless told otherwise. If
the Neon project is in `ap-southeast-1`, every query crosses an ocean — measured
at **214 ms per round trip**, which no amount of pool tuning will rescue on a
page that makes dozens. `vercel.json` pins them together:

```json
{ "regions": ["sin1"] }
```

One region is all Hobby allows, which is all this needs. Match the letter codes
to wherever the database actually is.

### Uploads do not go through the server

A serverless function may only receive a request body of about **4.5 MB**. An
invoice larger than that was rejected by the platform with a `413` before
`/api/upload` ran at all, so none of the route's own size checks could report it
— and the browser then tried to parse the plain-text error as JSON, which is
where `Unexpected token 'R'` came from.

So the file no longer passes through the function. `/api/upload` issues a signed
token and nothing else; the browser uploads straight to Blob storage. That route
is therefore the only gate — signed in, holds `stock.create` or `stock.edit`,
entry still DRAFT or REJECTED, right MIME type, within `maxSizeBytes` — because
refusing the token is what refuses the upload. The database row is written
afterwards by `recordStockAttachment` in `src/lib/actions/stock.ts`, which checks
all of it a second time, since everything it is told arrives from a browser.

Blob's own `onUploadCompleted` webhook is deliberately not used for that row: it
is called from Blob's servers and cannot reach a machine running on localhost,
which would have made uploads impossible to test in development.

**The store must be PRIVATE, and the code assumes it.** Invoices carry vendor
names, amounts and GST numbers, so they are not world-readable by URL. Uploads
pass `access: "private"`, and the URL stored in `fileUrl` fetches nothing on its
own — asking for it directly returns `403 Forbidden`. Every viewing goes through
`getAttachmentViewUrl` in `src/lib/actions/stock.ts`, which signs a link that
expires after ten minutes, and only for someone who can already see the stock
entry the document belongs to.

Two errors both mean "the access mode does not match":

* **"Failed to retrieve the client token"** — the Blob client discards the
  reason our server gave it, so this one message covers every refusal. Usually
  `BLOB_READ_WRITE_TOKEN` is missing or is not a store token.
  `checkAttachmentUpload` now catches both before the upload starts and says so
  in words.
* **A CORS error on `vercel.com/api/blob`** — misleading, because that host is
  correct and nothing is misrouted. Vercel rejected the upload with a 400 and
  returned no CORS headers, which is all the browser can see. Asking a private
  store for public access produces exactly this.

### Checking a deployment is configured: /api/health

`GET /api/health` reports the database plus the settings a deployment cannot run
without, as booleans — never values:

```json
{ "status": "ok", "database": "ok",
  "config": { "sessionSecretSet": true, "hostTrusted": true,
              "nextAuthUrlSet": false,
              "blobTokenSet": true, "blobTokenLooksValid": true } }
```

Open it first whenever something fails right after a deploy. It exists because
these settings fail with messages that explain nothing:

| What you see | What it means |
| --- | --- |
| Signing in returns 500, *"There was a problem with the server configuration"* | `sessionSecretSet` is false. Auth.js refuses every request before anything runs |
| Signing in redirects to localhost | `nextAuthUrlSet` is true with a development value. On Vercel, leave it unset |
| `"Failed to retrieve the client token"` when uploading | `blobTokenSet` or `blobTokenLooksValid` is false |

`status` is `degraded` (503) whenever the database is unreachable or sign-in
cannot work, so an uptime monitor catches a misconfigured deploy too.

**Environment variables are baked in at build time.** Adding one to an existing
deployment changes nothing until you redeploy — and check it is set for the
right *Environment*, since a variable added only to Preview leaves Production
without it.

### What you give up on the free tier

* Neon suspends the database after a few minutes idle; the first request after a
  quiet spell waits about a second while it wakes.
* Server actions are capped at 60 seconds. Nothing here comes close today, but a
  large report might one day.
* Blob storage and bandwidth have monthly allowances. Test invoices will not
  trouble them; check the dashboard before uploading anything in bulk.

---

## Moving onto one small VPS (1 GB RAM, 25 GB disk)

**Why you would.** Not because Neon is slow — because of the distance to it.
Measured from a laptop in India to the Neon project in `ap-southeast-1`: a raw
TCP handshake took **269–550 ms**, a warm query round trip **716 ms**, and the
connection failed outright often enough to be noticed. A page that makes eighty
queries cannot be rescued from that by tuning any of them.

**This affects local development far more than production**, because
`vercel.json` already pins the functions to `sin1`, next to the database. Before
moving anything, check whether the *deployed* site is slow too. If only
`localhost` is slow, run Postgres locally (below) and change nothing else.

### Is 1 GB enough? Yes, with two precautions

The database is **11 MB**. The largest table is 208 kB. Nothing here is big.

| | Needs | Note |
|---|---|---|
| Disk | well under 10 GB of your 25 GB | OS 3–5 GB, images ~1 GB, database 11 MB, room for uploads |
| Postgres | ~150–250 MB RAM | The whole database fits in cache, so it never touches the disk |
| The app (`next start`) | ~150–300 MB RAM | Production server only; nothing like a dev server |
| Ubuntu | ~150–250 MB RAM | |
| **Your existing website** | **unknown — the deciding number** | A static site on nginx is ~30 MB. WordPress with MySQL is 400 MB+ and changes the answer |

**A measured example.** The brand-website droplet, before anything was added:

```
               total   used   free  shared  buff/cache  available
Mem:             961    466    158       4         506        495
Swap:              0      0      0
/dev/vda1        24G   3.5G    20G  15% /
```

`available` — 495 MB — is the number that matters; it already counts the
reclaimable cache. Against ~350–430 MB for Postgres plus the app, that fits with
roughly 100 MB to spare. It works, but nothing about it is comfortable, and
`Swap: 0` means an out-of-memory moment kills a process rather than slowing one
down. **Add swap before adding the workload.**

Before committing, find out what the existing usage actually is —
`sudo smem -t -k -P .` reports PSS, which counts shared memory honestly where
plain RSS double-counts it. If most of it turns out to be a MySQL instance
behind a WordPress site, tuning its buffer pool down often frees 100–200 MB and
changes the answer from "tight" to "comfortable".

Disk is a non-issue. **RAM is the only real constraint**, and the two things
that will bite you are:

1. **`next build` will run out of memory on 1 GB.** Next builds routinely peak
   over 1 GB. Build the image on your own machine and push it to a registry, or
   add swap before building on the droplet.
2. **Neon runs PostgreSQL 18; `docker-compose.yml` pins `postgres:16-alpine`.**
   A dump taken from 18 can fail to restore into 16. Change the image to
   `postgres:18-alpine` before you start, so both ends match.

### 1. Prepare the droplet

Swap is not optional on a 1 GB box — it is what turns an out-of-memory kill into
a slow moment.

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl -w vm.swappiness=10        # prefer RAM; use swap as a safety net
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
free -h                                 # confirm
```

Then Docker, if the droplet does not already have it:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER          # log out and back in
```

### 2. Take a dump from Neon

Two details matter and both are easy to get wrong:

* Use the **direct** connection string, not the `-pooler` one. `pg_dump` through
  pgbouncer produces broken dumps.
* Use a **version 18** `pg_dump`. Running it inside a container is the simplest
  way to guarantee that, whatever your laptop has installed.

```bash
docker run --rm postgres:18-alpine \
  pg_dump --no-owner --no-privileges \
  "postgresql://USER:PASSWORD@ep-....neon.tech/neondb?sslmode=require" \
  > neon-backup.sql

grep -c "" neon-backup.sql             # sanity check: not an empty file
```

`--no-owner --no-privileges` drops Neon's role names, which will not exist on
your droplet. The dump carries the schema, the data, **and Prisma's
`_prisma_migrations` table** — which is what makes the restored database
already know which migrations have run.

### 3. Bring the stack up

Copy the repository (or `git clone` it) onto the droplet, then:

```bash
cp .env.example .env.production        # fill it in — see "Before anyone else
                                        # can reach it" below
docker compose --env-file .env.production up -d db
```

Restore into the empty database **before** starting the app:

```bash
cat neon-backup.sql | docker compose exec -T db psql -U sam -d straightdrive
docker compose exec db psql -U sam -d straightdrive -c '\dt'   # tables present?
```

Do **not** run `npm run db:seed` — it wipes first. Do not run
`prisma migrate deploy` either until you have confirmed the restore worked; the
dump already brought the migration history with it.

Then the app:

```bash
docker compose --env-file .env.production up -d app
docker compose logs -f app
```

`DATABASE_URL` in the compose file already points at `db:5432` over Docker's
internal network — **that is the whole point of the move.** The query round trip
goes from ~700 ms to well under 1 ms, and the port is never published.

### 4. Tune Postgres down for a small box

The defaults assume a machine with more to spare. For an 11 MB database and a
handful of users, add to the `db` service in `docker-compose.yml`:

```yaml
    command: >
      postgres
      -c max_connections=20
      -c shared_buffers=96MB
      -c effective_cache_size=256MB
      -c work_mem=4MB
      -c maintenance_work_mem=32MB
```

`max_connections` is the one that matters: every connection reserves memory
whether or not it is used, and 100 of them on a 1 GB box is most of a gigabyte
promised away. Twenty is generous for ten people.

### 5. Backups are now yours

This is the real cost of leaving Neon, and the step not to skip. Neon did
point-in-time recovery for you; a droplet does nothing unless you ask.

```bash
sudo tee /etc/cron.daily/sam-backup >/dev/null <<'SH'
#!/bin/sh
cd /path/to/stock-asset-management || exit 1
docker compose exec -T db pg_dump -U sam straightdrive \
  | gzip > /var/backups/sam-$(date +%F).sql.gz
find /var/backups -name 'sam-*.sql.gz' -mtime +14 -delete
SH
sudo chmod +x /etc/cron.daily/sam-backup
```

**A backup on the same droplet is not a backup.** Add an offsite copy — `rclone`
to any object store, or `scp` to another machine — or a lost droplet is a lost
database. Test a restore once, before you need one.

### 6. Decide where uploads live

Invoices currently go to **Vercel Blob**, which keeps working from anywhere: it
is an HTTPS API, not a Vercel-only feature. Keep `BLOB_READ_WRITE_TOKEN` set and
nothing changes. The alternative is the local `uploads` volume the compose file
already defines — cheaper, but then it is one more thing your backup has to
cover.

### 7. Check it

`GET /api/health` on the new host, as described above. Then sign in, open
Reports, and watch the timing — that is the number this whole exercise was for.

### If only local development is slow

Do not move anything. Run Postgres on your own machine and leave production
where it is:

```bash
docker compose up -d db                # add a ports mapping: "5432:5432"
# point DATABASE_URL in .env at postgresql://sam:...@localhost:5432/straightdrive
npx prisma migrate deploy
npm run db:seed                        # empty database only
```

Ten minutes, no ops burden, no backups to own, and development queries drop from
~700 ms to under a millisecond.

---

## Before anyone else can reach it

These are not optional, and they matter more than the choice of host.

1. **Rotate every password.** `Welcome@123!` is in `prisma/setup-roles-and-people.ts`,
   which is in the repository. You no longer have to chase this by hand: the
   seed marks every account `mustChangePassword`, so each person is stopped at
   `/settings/password` on first sign-in and cannot go anywhere else until they
   have replaced it. Set `newPassword` per person before seeding if you want
   their starting password to differ from the default.
2. **Generate a fresh `NEXTAUTH_SECRET`** for this environment. Sharing the
   development one means a development session cookie works in production.
3. **Leave `PASSWORD_ENCRYPTION_KEY` unset.** With it set, the app keeps a
   reversible copy of every password so `users.password.view` can reveal them —
   convenient internally, but it means a copy of the database plus the key is a
   copy of everyone's password. Unset, sign-in and password changes work
   exactly as before; passwords simply cannot be revealed afterwards.
4. **Do not publish the database port.** The compose file deliberately does not
   map 5432.
5. **Put it behind something** while it is a test instance: your office IP
   range, a VPN, or basic auth at the proxy. The in-process login lockout is a
   speed bump, not a defence.
6. **Back up before each test round:**
   `docker compose exec db pg_dump -U sam straightdrive > backup-$(date +%F).sql`.
   A destructive test then costs a restore rather than a reseed.

---

## Testing it thoroughly, once it is up

**Seed it — never copy real data.** `npm run db:seed` creates the eleven
accounts that `docs/test-cases-permissions.md` names, so the suites are ready to
run as written.

**Turn on error reporting.** Today a server action that throws shows the user a
toast and tells you nothing. Sentry's free tier covers both server and client;
it needs an account and a DSN, so it is your step rather than mine. Until then,
`docker compose logs -f app` is the only record.

**Run the suites that have never been run.** The login-dependent halves of
`docs/test-cases-permissions.md` (105 keys, ten people) and
`docs/test-cases-stock-approval.md` need a browser and real sessions. A hosted
instance with seeded accounts is exactly what they were written for.

**Then break it deliberately.** This is where the "mishandled events" you are
looking for actually live. One session each, and write down what happened:

| Try | What should happen |
| --- | --- |
| Two people approve the same entry at once | the second gets *"This step has already been processed"*, not a double approval |
| Dispatch more than is in stock | refused before the consignment is raised |
| Two people edit one rejected entry, both save | last write wins, and neither loses the other's attachment |
| Upload a file over the configured limit, and a wrong file type | refused with the limit named, not a 500 |
| Receive more against a purchase order than was ordered | refused — `checkOrderLineCapacity` should catch it at submit |
| Pull the network mid-approval, then retry | no half-approved entry; the retry either works or says why |
| Delete a vendor that entries point at | entries survive with the vendor unlinked, and the recycle bin can restore it |
| Sign in as a deactivated person | refused, with their history still readable under their name |

Each one that behaves badly gets a row in the test documents, the same as the
findings already there.
