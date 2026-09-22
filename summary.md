# Where everything lives

A map of the codebase: which file to open, and in what order to read them the
first time.

Read `README.md` first for what the system *does*. This one is about where it
is.






<!-- index:start -->

## Contents

- [Read these nine, in this order](#read-these-nine-in-this-order)
- [How a page works](#how-a-page-works)
- [The folders](#the-folders)
- [Which file do I edit?](#which-file-do-i-edit)
- [Adding things](#adding-things)
- [Gotchas](#gotchas)

<!-- index:end -->

---

## Read these nine, in this order

Each one makes sense on its own and sets up the next. Together they are the
whole system; everything else is a variation on them.

| # | File | Why this one |
|---|---|---|
| 1 | `prisma/schema.prisma` | The nouns. Read `User`, `Role`, `Department`, `Location`, `StockEntry`, `StockIssue` and stop — the rest will make sense later. |
| 2 | `src/lib/rbac/permissions.ts` | Every capability in the system, and the three scope resolvers. The whole authorization model is one file. |
| 3 | `src/lib/rbac/check.ts` | The four guards every action starts with. Short. Note that they *redirect*. |
| 4 | `src/auth.ts` | Sign-in, and the one place a person's capabilities are worked out — the union of every role they hold plus individual grants. |
| 5 | `src/lib/actions/stock.ts` | The main journey, start to finish. Read the `FLOW:` block at the top first. |
| 6 | `src/lib/stock-availability.ts` | Why "how many are left" is harder than `quantity`. Four things draw stock down. |
| 7 | `src/lib/stock-visibility.ts` | Who sees which stock. The one rule six screens share. |
| 8 | `src/app/(dashboard)/stock/page.tsx` | A page, end to end: gate → fetch → hand to a client component. Every other page is this shape. |
| 9 | `middleware.ts` | Route → permission. Small, and explains why some pages bounce. |

After those, pick a journey from the README and read the action file it names.
`grep -rn "FLOW:" src/lib/actions/` lists all eight.

---

## How a page works

Every page in this app has the same four steps. Once you have seen one, you have
seen them all.

```
src/app/(dashboard)/stock/page.tsx        ← a SERVER component
  │
  ├─ requirePermission("stock.view")       1. gate: redirects if they may not
  ├─ await getStockEntries()               2. fetch, via a server action
  │     └─ src/lib/actions/stock.ts
  │           ├─ requireAnyPermission()      the action gates itself too
  │           ├─ resolveStockScope(user)     how much may they see?
  │           └─ prisma.stockEntry.findMany()
  │
  └─ <StockEntryList entries={...} />      3. hand to a CLIENT component
        └─ _components/stock-entry-list.tsx  4. which renders, and calls
                                               actions back on click
```

**Why the action gates itself as well as the page.** A server action is a real
HTTP endpoint. Anyone signed in can call it directly, whatever the page chose to
render — so the page's gate is for the user's experience, and the action's gate
is the actual security.

**Server vs client.** A file with `"use client"` at the top runs in the browser
and can use `useState`; everything else runs on the server and can touch the
database. A server component can render a client one and pass it data, never the
other way round.

---

## The folders

```
src/
  app/
    (auth)/            login, unauthorized
    (dashboard)/       every real page. Each folder = one route
      <page>/
        page.tsx         the server component: gate, fetch, render
        _components/     the client components only that page uses
    api/               only three: upload (issues a blob token — the file
                       itself never touches the server), health, NextAuth
  lib/
    actions/           ← ALL reads and writes. One file per area
                         account.ts = your OWN account (no permission key)
    rbac/              permissions, and the guards
    validations/       Zod schemas, shared by the form and the server
    *.ts               the shared rules — see "one rule, one place" in README
  components/
    ui/                generated Base UI components. Do not hand-edit
    shared/            things used across pages: delete dialog, export button
    dashboard/         the dashboard's own cards
prisma/
  schema.prisma        the database
  migrations/          one baseline; add one file per change
  seed.ts              fills an EMPTY database
  setup-roles-and-people.ts   who can do what — the single definition
  lib/permission-catalog.ts   every permission, with descriptions
```

---

## Which file do I edit?

| I want to… | Open |
|---|---|
| Change what a role can do | `prisma/setup-roles-and-people.ts`, then run it |
| Add a permission | `prisma/lib/permission-catalog.ts` + `src/lib/rbac/permissions.ts` |
| Change who sees which stock | `src/lib/stock-visibility.ts` |
| Change what counts as available, or as held | `src/lib/stock-availability.ts` — `availableQuantity()` is what can be promised, `heldQuantity()` is what is physically there. A department holding has its own pair: `heldByIssue()` / `availableFromIssue()` |
| Change how repeat receipts of one product combine on the Reports page | `src/lib/stock-grouping.ts` for the arithmetic (the price column shows one price, or the min–max range) |
| Change a stock entry's fields or approval steps | Stored in the database (`getFieldConfigs()` / `getAttachmentTypeConfigs()` in `stock.ts` read it). The `/configure` page that edited it is taken out for now; until it returns, change the rows directly. A change only affects entries submitted *after* it |
| Change wording of product kinds or groups | `src/lib/vocabulary.ts` — every screen reads it |
| Change how a product code is assembled | `src/lib/product-codes.ts` — category prefix, optional subcategory segment, typed suffix |
| Change what a product must carry | The `catalog_config` row (the `/configure` card is taken out for now). The rules are read by `getCatalogRules()` and applied by `catalogRuleErrors()`, so the form and the server agree |
| Change the "What do you need?" dialog | `src/components/shared/need-dialog.tsx`; it saves through `requestNeeds()` in `src/lib/actions/needs.ts` |
| Change which products may have a bill of materials | `isMadeKind()` in `src/lib/vocabulary.ts` — only FINISHED today; raw materials and ready goods are bought |
| Add a page | a folder in `(dashboard)`, a route in `middleware.ts`, an item in `src/lib/constants.ts` (with its `group`) |
| Change the sidebar | `src/lib/constants.ts` — `NAV_GROUPS` is the headings, in order; each item names its group. The breadcrumb words are `ROUTE_LABELS` in `app-topbar.tsx` |
| Change when stock counts as low, how use is measured, or how "low since" is found | `src/lib/low-stock.ts` |
| Change which BOM components are watched, where, and at what minimum | `src/lib/low-stock-bom.ts` |
| Change the rack format ("10.3") | `RACK_PATTERN` in `src/lib/racks.ts` |
| Change who is notified of what, and the wording | `src/lib/notifications/events.ts` — every event in one file |
| Change how mail is sent (SMTP) | `src/lib/notifications/mail.ts`; settings in `.env.example` → Mail |
| Change when low stock and late orders are checked | `src/lib/notifications/checks.ts`; the daily job is `src/app/api/cron/daily/route.ts` + `vercel.json` |
| Change when an order line counts as on time or late | `src/lib/order-timing.ts` |
| Change who may act on another person's account | `src/lib/rbac/authority.ts` — one rule for edit, password, status, delete, roles, grants, departments |
| Stop two people taking the same stock at once | `lockEntries()` in `src/lib/stock-locks.ts`, inside the transaction that takes it |
| Change who may attach documents | `src/lib/attachment-rules.ts` — used by the upload route and every attach action |
| Change what a need request PDF looks like | `src/lib/need-list-pdf.ts` |
| Change who a deleted person's records move to, or add a table that points at people | `PERSON_LINKS` in `src/lib/actions/users.ts` — a new column that points at a user must be listed there, or deleting that user fails |
| Change a reference number format | `src/lib/reference-numbers.ts` |
| Change how long deletions are kept | `RECYCLE_BIN_DAYS` in `src/lib/recycle-bin.ts` |
| Change what `permissions.md` says | `prisma/generate-permissions-doc.ts`, then `npm run docs:permissions` — the file itself is generated and hand edits are overwritten |
| Change how often pages update themselves | `src/hooks/use-live-data.ts`; mounted for the whole dashboard by `src/components/shared/live-data.tsx` |
| Add a filter to the stock list | `src/app/(dashboard)/stock/_components/entry-filters.tsx` for the control, `stock-entry-list.tsx` for the matching, and the URL keys in `stock/page.tsx` |
| Deploy it, or change the image | `Dockerfile`, `docker-compose.yml`, `docs/hosting.md` |
| Change the colour of a status badge anywhere | `src/lib/design/status.ts` — `TONE_BY_STATUS` maps the status word to one of five tones, `statusPill()` is what components call. Never write `bg-amber-50` on a badge: it has no dark-mode variant |
| Change how a rupee figure is printed | `src/lib/format.ts` — three functions, differing only in how they treat paise |
| Test that a permission actually gates something | `docs/test-cases-permissions.md` (all 113 keys) or `docs/test-cases-stock-approval.md` (the arriving-goods flow in depth) |
| Find out why something was built this way | `docs/decisions.md` — the questions that were settled, and what was settled |

### The areas, and their action file

| Area | Action file | Page |
|---|---|---|
| Goods arriving | `stock.ts` | `/stock` |
| Several items arriving together (a delivery) | `deliveries.ts` | `/stock/new?mode=delivery`, `/stock/delivery/[id]` |
| Racks: where stock sits, and finding it | `racks.ts` | `/stock/find`, each entry's page |
| A person's notifications and mail choices | `notifications.ts` | the bell, `/settings/profile` |
| Buying | `procurement.ts` | `/procurement` |
| Raising needs (one or many), need requests and their downloads | `needs.ts` | `/procurement`, `/builds` |
| Low stock: what is watched, and minimums | `low-stock.ts` | `/procurement`, the bell |
| Who supplies what, and each pair's lead time | `suppliers.ts` | `/vendors`, `/stock/products`, `/procurement` |
| Departments' holdings, transfers | `assets.ts` | `/assets` |
| Catalog, and requests for it | `products.ts` | `/stock/products` |
| What things are made of | `bom.ts` | `/bom` |
| Making them | `builds.ts` | `/builds` |
| Goods leaving | `dispatch.ts` | `/dispatch` |
| Cross-site readiness | `fulfilment.ts` | `/builds` (Plan tab), `/dispatch` (Site requests) |
| Reports | `reports.ts` | `/reports` |
| Damaged, lost and unusable stock | `write-offs.ts` | `/wastage` |
| History | `activity.ts` | `/activity` |
| People, roles, departments | `users.ts`, `roles.ts`, `departments.ts` | `/users`, `/roles`, `/departments` |
| Vendors, clients | `vendors.ts`, `clients.ts` | `/vendors`, `/clients` |
| Undeleting | `recycle-bin.ts` | `/recycle-bin` |

---

## Adding things

### A permission

1. `prisma/lib/permission-catalog.ts` — the key, with a description a
   non-programmer can read
2. `src/lib/rbac/permissions.ts` — the constant
3. `requirePermission(...)` on the action **and** hide the UI without it
4. `middleware.ts` if it opens a page
5. Grant it in `prisma/setup-roles-and-people.ts` and run that. The script
   creates the new permission row first, so this works on a live database —
   never use `db:seed` for it, which wipes everything
6. `npm run docs:permissions`

If the new key is useless on its own — approving something you cannot see —
declare that in `src/lib/rbac/permission-dependencies.ts`, and the role editor
will offer to add the missing one at the moment the box is ticked.

### A page

A folder under `(dashboard)`, plus **three lists that must agree**: the page's
own gate, its route in `middleware.ts`, and its nav item in
`src/lib/constants.ts`. When they disagree, someone is either shut out of a page
they can use or shown one they cannot. `npm run audit:access` catches most of it.

### A database change

`prisma migrate dev` is interactive and does not work here. Write the SQL by
hand in a new folder under `prisma/migrations/`, then `npx prisma migrate
deploy`. Stop the dev server before `npx prisma generate`, and start it again
afterwards — on any machine, not just Windows. A running server keeps the
database client it started with, so after a schema change it fails with
"Cannot read properties of undefined (reading 'findMany')" on the new table
until it restarts. The code and database are fine; the process is stale.

---

## Gotchas

- **Base UI, not Radix.** Keep `Select`s controlled (`value={state}`, empty
  string included), give them an `items` map so the trigger shows the label, and
  set `nativeButton={false}` on a `Button` rendered as a link.
- **A failed `requirePermission` redirects.** So a page can bounce to
  `/unauthorized` because of one action it calls, even when its own gate passed.
  Gate an action on what *it* does, not on a neighbour.
- **Next answers 200 for a gated page** and delivers the redirect inside the
  streamed payload. If you are testing with `curl`, the status code tells you
  nothing — look at the body.
- **Prisma schema comments must be `//`**, never `/** */`.
- **Sticky panels** (the role editor, the profile column) use
  `lg:sticky lg:top-[4.5rem]` with `lg:h-[calc(100vh-7.5rem)]` and an inner
  `overflow-y-auto`. The topbar is `sticky top-0 h-14`, which is where 4.5rem
  comes from.
- **Wide tables scroll in their own container** (`overflow-x-auto`), never the
  page body.
