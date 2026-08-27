# Plan — list interaction, dispatch provenance, live updates, hosting

Four requests, smallest first. Nothing here is built yet; each phase is
separately shippable and separately abandonable.

| Phase | What | Size | Risk |
| --- | --- | --- | --- |
| 1 | Click the row for the summary, the eye for the full entry | half a day | low |
| 2 | Say where transferred stock came from | 1–2 days | medium — schema change |
| 3 | Updates without pressing refresh | 1 day, then optional 2 more | medium |
| 4 | Host it for real testing | 1–2 days | medium — secrets and uploads |

---

## Phase 1 — Row opens the summary, eye opens the entry

**Today.** Clicking a row does nothing at all: the shared table
(`src/components/shared/data-table.tsx`) has no row-click support. The eye icon
opens the quick summary, and the only route to the full entry is the *View full
entry* link inside that dialog (`entry-summary-dialog.tsx:200`).

**Wanted.** Row → summary popup. Eye → straight to `/stock/[id]`.

**Changes.**

1. `src/components/shared/data-table.tsx` — add one optional prop,
   `onRowClick?: (row: TData) => void`. When given, the `<TableRow>` gets the
   handler, `cursor-pointer`, and keyboard equivalence (`tabIndex={0}`, Enter and
   Space) so the row is not mouse-only. Without the prop the table behaves
   exactly as now — it is used in one other place
   (`activity/_components/activity-table.tsx`), which passes nothing and is
   unaffected.
2. `stock-entry-list.tsx` — pass `onRowClick={setSummaryEntry}`; change the eye
   cell from a `Button` that opens the dialog into a `Link` to `/stock/${id}`
   (still `stopPropagation`, so it never also fires the row). A real link keeps
   middle-click, ctrl-click and keyboard focus working.
3. The paperclip cell already stops propagation and stays as it is.

**Watch for.** The eye becoming a link inside a table cell needs
`nativeButton={false}` if it keeps the `Button` styling — the Base UI gotcha this
project has hit before.

**Verify.** Click a row → dialog. Click the eye → full page. Ctrl-click the eye →
new tab. Tab to a row, press Enter → dialog. Click the paperclip → documents,
and no dialog behind it.

---

## Phase 2 — Say where transferred stock came from

**Today** (`src/lib/actions/dispatch.ts:534`, inside *Confirm Delivery*):

- Stock **is** added automatically at the receiving location. A new `StockEntry`
  is created with `status: "APPROVED"`, `createdById` and `approvedById` set to
  whoever confirmed delivery. Nobody re-books it, nobody re-approves it.
- It copies the origin entry's product, vendor, supplier name, invoice number
  and unit price.
- It does **not** set `source`, so it defaults to `PURCHASED`.
- It does **not** carry `batchNumber`, although the dispatch line has one.
- Nothing links it back to the dispatch it came from.

So a Hyderabad manager sees an entry that looks like a fresh purchase from a
Bengaluru vendor, with no batch and no way to reach the consignment.

**Proposed.**

1. **Schema** (`prisma/schema.prisma`):
   - `enum StockSource` gains `TRANSFERRED`.
   - `StockEntry` gains `sourceDispatchItemId String?` with a relation to
     `DispatchItem`, mirroring how `buildId` already records that an entry came
     out of a build. One nullable column and one index; no data migration
     needed for existing rows.
2. **Write it** — in the receive branch, set `source: "TRANSFERRED"`,
   `sourceDispatchItemId`, and `batchNumber: item.batchNumber`. While in there,
   replace the hand-rolled `SE-<date>-<seq>` numbering with the shared
   `nextReference("SE")` — there are currently two implementations of the same
   number, and the inline one can collide under concurrent receipts.
3. **Show it** — the entry detail page and the stock list get a provenance line:
   *"Transferred from Bengaluru on DSP-20260814-002"*, linking to the dispatch
   for anyone holding `dispatch.view` (a plain sentence without the link for
   everyone else — no dead links, and the permission rule holds). `Built in
   house` already reads this way for builds, so this follows the existing shape.
4. **Historic rows stay as they are.** Past transfers cannot be matched back to
   their consignments with confidence, so they keep looking like purchases. Say
   so in the UI rather than guessing: only entries created after this ships will
   carry the label.

**One decision for you.** Should a received consignment still be auto-approved?
The argument for keeping it: the goods were approved at the origin, and
*accepting* the consignment is already a deliberate act by a second person. The
argument against: the receiving site never books in what it actually got, so a
short delivery is invisible. My recommendation is to keep auto-approval and add
the label — but if you want receipt to book a *draft* that the destination
confirms, that is a bigger change and belongs in its own phase.

**Verify.** Dispatch stock Bengaluru → Hyderabad, confirm delivery, then check
the new entry: `source = TRANSFERRED`, the batch matches the dispatch line, the
detail page names the consignment, and `lookupBatch` finds the goods at both
ends.

---

## Phase 3 — Updates without pressing refresh

**Today.** Every page is server-rendered on demand (the build lists them all as
`ƒ`), and 40 components call `router.refresh()` after their own action. So *your
own* changes appear immediately; *other people's* changes only appear when you
navigate or reload. Nothing is stale-cached — the data is simply not re-fetched.

Three layers, each useful on its own. I suggest 3a and 3b now, 3c only if the
first two are not enough.

**3a · Refresh when the tab comes back, plus a slow poll.** A small
`useLiveData()` hook calling `router.refresh()` on `visibilitychange`/`focus`,
and on a 30-second interval while the tab is visible. Mounted in the dashboard
layout so every page gets it, with an opt-out for pages holding an open form —
refreshing under someone who is typing is worse than stale data. Cost is one
RSC render per tab per interval; at your team size that is nothing.

**3b · Make your own actions feel instant.** The approve/reject/submit buttons
currently wait for a server round trip with a spinner. `useOptimistic` +
`useTransition` lets the row update immediately and roll back if the action
fails. This is where most of the "feels slow" impression actually comes from.

**3c · Real push, if you want it.** A `GET /api/events` route streaming
Server-Sent Events, with Postgres `LISTEN/NOTIFY` as the broadcast channel so it
still works with more than one server process. Server actions `NOTIFY` a channel
name (`stock`, `dispatch`, `approvals`); the client refreshes when it hears one
that matters to the page it is on. **Send only the channel name, never the
data** — otherwise the stream becomes a way around the permission rules. Needs a
host that allows long-lived connections (see Phase 4).

**Read first.** `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`
and `02-guides/streaming.md` — this Next version's behaviour differs from older
ones, and 3c depends on those details.

**Verify.** Two browsers, two accounts: approve in one, watch the other's stock
list change without a reload. Then confirm a half-filled form is never wiped by
a refresh.

---

## Phase 4 — Hosting it for real testing

**What the app needs**, from reading the code:

| Need | Why | Consequence |
| --- | --- | --- |
| PostgreSQL | `prisma/schema.prisma` | managed instance, with backups |
| **A persistent disk** | `src/app/api/upload/route.ts` writes into `public/uploads` | a serverless host loses every uploaded invoice on redeploy |
| A long-running Node process | Phase 3c (SSE) | rules out pure serverless if you want push |
| One region, small scale | ~12 people | the smallest tier of anything is plenty |

**Recommended: a container on a small managed host** — Railway, Render, or a
€5 Hetzner VPS with Docker. Concretely:

1. Set `output: "standalone"` in `next.config.ts` and add a Dockerfile (two
   stages: build, then a slim runtime).
2. Mount a volume at `/app/public/uploads`. **This is the step people skip**,
   and it is why uploads vanish.
3. Managed Postgres from the same provider; `prisma migrate deploy` on release,
   never `db push`.
4. Point a subdomain at it, HTTPS by default (Caddy does this itself on a VPS).

**Vercel is the alternative**, and it is a better developer experience, but it
needs work first: uploads must move to object storage (Vercel Blob or S3) —
roughly a day, touching the upload route, `deleteAttachment`, and the stored
`fileUrl` values — and SSE is awkward on serverless. If you want Vercel, do the
storage move as Phase 4a and run Phase 3 without 3c.

**Before it is reachable from the internet** — this matters more than the host:

- Rotate every seeded password. `Welcome@123!` is in the repository.
- Set a real `NEXTAUTH_SECRET` and a proper `PASSWORD_ENCRYPTION_KEY`. Note
  that the password-vault feature stores **reversible** passwords, so anyone who
  takes the database and the key gets everyone's password. Consider disabling
  the vault on the hosted instance by leaving the key unset.
- Rate-limit `/login`, and block search engines with `robots.txt` and a
  `noindex` header.
- Restrict access to your own IPs, or put the whole thing behind basic auth at
  the proxy, while it is a test instance.

**To actually find bugs once it is up:**

- **Seed it, do not copy production data.** `npm run db:seed` gives you the
  eleven accounts the test documents already name.
- **Error reporting.** Sentry (free tier) for both server and client. Without
  it, a server action that throws shows the user a toast and tells you nothing.
- **Run the suites you already have** on the hosted instance:
  `docs/test-cases-permissions.md` (105 keys, ten walkthroughs) and
  `docs/test-cases-stock-approval.md`. The login-dependent half of those has
  never been run.
- **Deliberately break things** — the "mishandled events" you are asking about.
  Worth a session each: two people approving the same entry at once; dispatching
  more than is in stock; a rejected entry edited by two people; an upload that
  exceeds the configured limit; a purchase order over-received; the network cut
  mid-action. Each one gets a line in the test docs with what actually happened.
- **Back up before each test round.** `pg_dump` into a dated file, so a
  destructive test is a restore rather than a reseed.

---

## Suggested order

1. **Phase 1** — an afternoon, visible immediately, no risk.
2. **Phase 4** — get it hosted early. Every later phase is easier to judge on a
   real instance, and the security list above has to happen before anyone else
   touches it.
3. **Phase 2** — the schema change, while the data is still small.
4. **Phase 3a and 3b** — live enough for a team your size.
5. **Phase 3c** — only if you still find yourself reloading.

Tell me which phases to start and I will plan each one in detail before writing
any code.

---

## Status — 18 Aug 2026

| Phase | State |
| --- | --- |
| 1 · Row opens the summary, eye opens the entry | **Done** |
| 4 · Hosting | **Prepared** — everything that is code is in place; the account, the host and the secrets are yours to create. See `docs/hosting.md`. |
| 2 · Transferred stock says so | **Done** — migration `20260818090000_transferred_stock_provenance` applied |
| 3a · Refresh on focus, and a slow poll | **Done** |
| 3b · Actions that do not look idle mid-save | **Done for stock approval**; the same `useTransition` pattern should spread to the other action components as they are touched |
| 3c · Server-Sent Events | Not started — deliberately, until 3a/3b prove insufficient |

Verified by typecheck, lint, a production build, and a live smoke test of
`/api/health`, `/robots.txt` and the `X-Robots-Tag` header. **Not** verified by
clicking through the UI — that still needs a browser and a session.
