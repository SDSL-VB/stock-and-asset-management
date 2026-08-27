# Hosting it

How to put this system somewhere real so it can be tested properly. Written for
a **test instance used by your own team**, not for a public product.

What the app needs, and why:

| Need | Why | If you get it wrong |
| --- | --- | --- |
| PostgreSQL | the whole data model | nothing runs |
| **A persistent disk at `/app/public/uploads`** | `src/app/api/upload/route.ts` writes invoices to the filesystem | every uploaded document disappears on the next deploy, silently |
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
| `src/app/api/health/route.ts` | `/api/health`, which checks the database rather than just the port |
| `src/app/robots.ts` | keeps the system out of search engines |
| `src/auth.ts` | eight failed sign-ins for one address buys a fifteen-minute lockout |

---

## Choosing a host

**Recommended — a container on one small machine.** Railway, Render, Fly.io, or
a €5 Hetzner box running the compose file. All of them give you a persistent
volume, which is the thing that matters. On a plain VPS put Caddy in front for
automatic HTTPS.

**Vercel is the alternative.** Better to deploy to, but the filesystem is
ephemeral, so uploads must move to object storage (Vercel Blob or S3) **first**.
That is a day's work touching the upload route, `deleteAttachment` in
`src/lib/actions/stock.ts`, and the stored `fileUrl` values. Do not deploy there
before that change: uploads will appear to work and then vanish.

Whichever you pick:

* Run `npx prisma migrate deploy` on each release. **Never `db push`** — it can
  drop columns to make the schema match.
* `npm run db:seed` **wipes the database first**. It is for an empty one only.

---

## Before anyone else can reach it

These are not optional, and they matter more than the choice of host.

1. **Rotate every password.** `Welcome@123!` is in `prisma/setup-roles-and-people.ts`,
   which is in the repository. Change them from each person's profile after the
   first sign-in, or set `newPassword` per person before seeding.
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
