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
| Change what counts as available, or as held | `src/lib/stock-availability.ts` — `availableQuantity()` is what can be promised, `heldQuantity()` is what is physically there |
| Change a stock entry's fields or approval steps | `/configure` in the app, not the code — but note it only affects entries submitted *after* the change |
| Change wording of product kinds or groups | `src/lib/vocabulary.ts` — every screen reads it |
| Add a page | a folder in `(dashboard)`, a route in `middleware.ts`, an item in `src/lib/constants.ts` |
| Change the sidebar | `src/lib/constants.ts` |
| Change a reference number format | `src/lib/reference-numbers.ts` |
| Change how long deletions are kept | `RECYCLE_BIN_DAYS` in `src/lib/recycle-bin.ts` |
| Change what `permissions.md` says | `prisma/generate-permissions-doc.ts`, then `npm run docs:permissions` — the file itself is generated and hand edits are overwritten |
| Change how often pages update themselves | `src/hooks/use-live-data.ts`; mounted for the whole dashboard by `src/components/shared/live-data.tsx` |
| Add a filter to the stock list | `src/app/(dashboard)/stock/_components/entry-filters.tsx` for the control, `stock-entry-list.tsx` for the matching, and the URL keys in `stock/page.tsx` |
| Deploy it, or change the image | `Dockerfile`, `docker-compose.yml`, `docs/hosting.md` |
| Test that a permission actually gates something | `docs/test-cases-permissions.md` (all 105 keys) or `docs/test-cases-stock-approval.md` (the arriving-goods flow in depth) |

### The areas, and their action file

| Area | Action file | Page |
|---|---|---|
| Goods arriving | `stock.ts` | `/stock` |
| Buying | `procurement.ts` | `/procurement` |
| Departments' holdings, transfers | `assets.ts` | `/assets` |
| Catalog, and requests for it | `products.ts` | `/stock/products` |
| What things are made of | `bom.ts` | `/bom` |
| Making them | `builds.ts` | `/builds` |
| Goods leaving | `dispatch.ts` | `/dispatch` |
| Cross-site readiness | `fulfilment.ts` | `/fulfilment` |
| Reports | `reports.ts` | `/reports` |
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
5. Grant it in `prisma/setup-roles-and-people.ts` and run that
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
deploy`. Stop the dev server before `npx prisma generate`.

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
