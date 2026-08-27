# Hosting it

How to put this system somewhere real so it can be tested properly. Written for
a **test instance used by your own team**, not for a public product.

What the app needs, and why:

| Need | Why | If you get it wrong |
| --- | --- | --- |
| PostgreSQL | the whole data model | nothing runs |
| Somewhere to put uploaded files | `src/app/api/upload/route.ts` stores invoices; it writes to Vercel Blob, so a persistent disk is no longer required | uploading errors with a missing-token message; nothing else is affected |
| A long-running Node process | ordinary server rendering, and Server-Sent Events later | works without it today; blocks live updates later |
| One small instance | about a dozen people | — |

---

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

### What you give up on the free tier

* Neon suspends the database after a few minutes idle; the first request after a
  quiet spell waits about a second while it wakes.
* Server actions are capped at 60 seconds. Nothing here comes close today, but a
  large report might one day.
* Blob storage and bandwidth have monthly allowances. Test invoices will not
  trouble them; check the dashboard before uploading anything in bulk.

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
