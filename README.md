# Stock & Asset Management

Straight Drive's internal system for goods: what we buy, what arrives, where it
sits, what we make from it, and what leaves.

Two sites — **Bengaluru** and **Hyderabad** — each with a central store and
several departments. Everything that happens to a physical thing happens through
one of the seven journeys in this document.


<!-- index:start -->

## Contents

- [Start here](#start-here)
- [The four ideas](#the-four-ideas)
  - [1 · A capability, never a job title](#1--a-capability-never-a-job-title)
  - [2 · No permission, no button](#2--no-permission-no-button)
  - [3 · Location narrows, it never grants](#3--location-narrows-it-never-grants)
  - [4 · One rule, one place](#4--one-rule-one-place)
- [The seven journeys](#the-seven-journeys)
  - [1 · Buying something](#1--buying-something)
  - [2 · Goods arriving](#2--goods-arriving)
  - [3 · Stock reaching a department](#3--stock-reaching-a-department)
  - [4 · Making something](#4--making-something)
  - [5 · Goods leaving](#5--goods-leaving)
  - [6 · Asking another site](#6--asking-another-site)
  - [7 · Asking for a product](#7--asking-for-a-product)
- [Undoing things](#undoing-things)
- [Running it](#running-it)

<!-- index:end -->

---

## Start here

If you are reading this codebase for the first time, `summary.md` has a **stated
reading order** — nine files, in sequence, that between them explain the whole
system. Read this document first for what the system *does*, then that one for
where it lives.

**The stack.** Next.js 16 (App Router) · React 19 · Prisma + PostgreSQL ·
NextAuth v5 · Tailwind 4 · components built on Base UI.

**The shape.** Every page under `src/app/(dashboard)` is a server component. It
calls server actions in `src/lib/actions/*`, which are the only way anything
reads or writes the database. There are no REST endpoints except file upload and
authentication.

---

## The four ideas

Everything below follows from these. If something surprises you, one of these is
usually the reason.

### 1 · A capability, never a job title

Every single thing you can do has its own permission — `stock.approve`,
`assets.transfer.request`, `procurement.po.create`. **Nothing anywhere is
decided by a role's name.** A role is just a convenient bag of permissions, and
it is edited live on the Roles page.

This is why one person can hold several roles at once: Kirubakaran is a
Department Manager *and* a Buyer *and* a Stock Approver *and* a Builder, because
those are four jobs, not four job titles. His permissions are the union of all
four. See `permissions.md` for who holds what today — it lists every role, every
person in plain language, and every permission with a line on what it unlocks.
It is generated from the database by `npm run docs:permissions`, so change the
generator rather than the file.

To check that permissions really behave that way, `docs/test-cases-permissions.md`
walks all 105 keys through the screens they govern, naming a person who holds
each key and a person who does not. `docs/test-cases-stock-approval.md` does the
same in depth for one flow: goods arriving, being submitted, and being approved.

### 2 · No permission, no button

A capability someone lacks is **not rendered at all** — never greyed out, never
a button that errors when clicked. Tabs, table columns, nav items, dashboard
cards and whole page sections simply are not there. Each person's screen
contains only what they can actually do.

### 3 · Location narrows, it never grants

A person's site comes from their **department**, not from a field on their
account. Someone with no department — Super Admin, Admin — therefore has no
site, and is never narrowed by one.

This is the pattern to copy wherever location is involved: you do not check
"are they allowed everywhere?", you check whether they have a site at all.

### 4 · One rule, one place

Anything more than one screen needs to agree about lives in exactly one file:

| The rule | Lives in |
|---|---|
| How much of an entry is here, and how much is still free to promise | `src/lib/stock-availability.ts` |
| Who may see which stock | `src/lib/stock-visibility.ts` |
| How a product code is built | `src/lib/product-codes.ts` |
| What counts as delivered against an order | `src/lib/procurement-delivery.ts` |
| Whether a bill of materials loops | `src/lib/bom-tree.ts` |
| Reference numbers (`SE-`, `PO-`, `DSP-`…) | `src/lib/reference-numbers.ts` |
| Nobody answers their own request | `src/lib/review-rules.ts` |
| How long a deletion stays recoverable | `src/lib/recycle-bin.ts` |

---

## The seven journeys

Each one is a `FLOW:` comment block at the top of the file that owns it —
`grep -rn "FLOW:" src/lib/actions/` lists them all.

### 1 · Buying something

**`src/lib/actions/procurement.ts` · page `/procurement`**

> An engineer needs 50 metres of cable. There is none. So they say so, someone
> decides it is worth buying, and it becomes an order.

1. **State a need.** Anyone with `procurement.intent.create` raises one. It
   records the department asking automatically — that is not something you pick.
2. **Verify it.** A Buyer decides whether it is worth ordering. This step can be
   switched off entirely on the Configuration page, and then anything raised is
   immediately orderable.
3. **Raise the order.** One or more verified needs go onto a single order to a
   single vendor, with agreed prices. Each need can only be ordered once.
4. **Goods arrive** — that is journey 2.
5. **The order closes itself** when the last outstanding unit is booked in.

**Nothing stores how much is still outstanding.** It is the ordered quantity
less the stock entries pointing at the line. That is the whole mechanism, and it
means a part delivery needs no bookkeeping beyond entering what actually turned
up — there is no second number that can drift.

An order can also be **closed short** when a vendor will simply not supply the
rest. That is a decision, and a late delivery never silently undoes it.

### 2 · Goods arriving

**`src/lib/actions/stock.ts` · pages `/stock`, `/stock/new`**

> A box turns up at the Bengaluru store. Somebody has to write down what is in
> it, and somebody else has to agree.

1. **Book it in.** The operator says whether these goods are **fresh stock** or
   **against a purchase order**. Picking an order line fills in the product, the
   vendor, the site and how many are still owed. Saved as a draft.
2. **Attach the documents.** The invoice is required before it can be submitted;
   which documents are required is configurable.
3. **Submit it.** This is the moment the goods count as **delivered** against an
   order. The approval flow is snapshotted onto the entry — copied as values,
   **once**. Editing the flow afterwards changes what the *next* submission
   copies and never touches an entry already in flight. (If an entry somehow
   reaches this state with no steps recorded, an approver gets a **Restore
   approval steps** button on it, because otherwise nothing in the app could
   move it again.)
4. **Approve it.** Someone holding `stock.approve`, **at the site the goods
   arrived at**. Rejecting sends it back to draft with a reason — and re-opens
   any order that closed itself when it was submitted.

Approved stock sits in **central stock** at its site until something moves it.

**A stock entry records what ARRIVED, and never changes.** What is still there is
worked out by subtracting everything that has left it — issued to a department,
loaded onto a consignment, consumed by a build. Two functions in
`src/lib/stock-availability.ts` name the two questions:

- `heldQuantity()` — what is **physically here**. A pending transfer request is
  not subtracted, because nothing has moved; somebody has only asked.
- `availableQuantity()` — what can still be **promised**: the same figure, less
  those pending requests. Never larger than the first.

Every screen showing a stock figure must use one of them. Showing the raw
`quantity` counts goods at the site they left and the site they arrived at
simultaneously, which is exactly the bug that produced three PCs on screen for
one physical machine.

**Stock that arrives from another site** skips all of this. Confirming delivery
of a consignment books it in at the destination already approved — the goods
were approved once at the origin, and accepting the consignment is itself a
second person's decision. Those entries carry `source = TRANSFERRED`, the batch
number from the consignment line, and a link back to it, so they never read as a
purchase the receiving site never made.

### 3 · Stock reaching a department

**`src/lib/actions/assets.ts` · page `/assets`**

> Production needs 3 of those cables. They are in the central store.

There are two ways, and they end at the same place:

- **Ask.** An engineer raises a transfer request; their department's manager
  agrees. **Approving it *is* the movement** — there is no second step.
- **Take.** Anyone holding `stock.move` moves it directly, no request involved.

Either way the result is a **stock issue**: the quantity leaves central stock
and the department now holds it. If it was marked as an **asset**, that is all
"asset" means — this system has no separate asset register, only stock that was
moved into a department as one.

### 4 · Making something

**`src/lib/actions/bom.ts` and `builds.ts` · pages `/bom`, `/builds`**

> We assemble a simulator from a frame, a screen and a controller.

**First, write down what it is made of.** A bill of materials lists the
components and how many of each go into one unit. A member writes it; the
manager **of that member's department** publishes it. Versions are the safety
net: editing the live one fixes a mistake, publishing a new one records a design
change, and old versions stay readable so past work still explains itself.

**Then build it.** Building 3 simulators takes 3 frames, 3 screens and 3
controllers *out* of central stock and books **3 simulators** *in* as an
ordinary approved entry. Dispatch then offers the simulator as a whole with no
special case, and the 7 screens left over still show as screens.

- Components leave the shelf when work **starts**, not when it finishes.
- **Start 10, finish 6**, and 4 stay *on the floor* — counted, visible, not
  dispatchable. How many are finished is never stored; it is the sum of the
  entries the run produced, so the two numbers cannot drift.
- **Close short** ends a run that will not be completed. The components for the
  shortfall stay consumed — they are in scrap or half-built units, not back on
  the shelf.
- **Undo** works only while nothing has moved or been dispatched from any batch
  the build produced.

Only the **top level** is consumed. A component that has its own bill of
materials is expected to have been built already.

### 5 · Goods leaving

**`src/lib/actions/dispatch.ts` · page `/dispatch`**

> Ten simulators go to a customer in Chennai. Or five go to Hyderabad.

**To another site**: raised → the destination **accepts** → marked **received**,
which books the stock in as central stock there, so every existing query sees it
with no special case.

**To a client**: leaves immediately — there is nobody at the far end to accept.
Goods bought to ship straight from the vendor to a customer raise their
consignment automatically when the entry is approved.

**Two exits, not one.** The destination can **reject** it; the origin can
**cancel** it. Both need a reason, and **neither touches stock** — the committed
quantity simply frees itself, because those statuses are not counted as holding
anything.

**Nobody may accept or reject a consignment they raised themselves.**

**Batch numbers are the recall chain.** A batch is typed once, on the stock
entry, and every dispatch line inherits it. Looking one up returns every
consignment carrying it — and that list *is* the recall list.

### 6 · Asking another site

**`src/lib/actions/fulfilment.ts` · page `/fulfilment`**

> Hyderabad has an order for 5 and holds 2. Bengaluru has 30.

The **fulfilment planner** answers "can we meet this?" across every site at
once: what is on the shelf where, what could be *built* there from components
already held, and how far short we still are. It stores nothing — it is a
question asked of current stock.

Anyone who can open it sees **every site's availability**, because you cannot
ask for stock you cannot see. What stays scoped is the detail: the entries
behind those numbers, with their vendors, prices and invoices.

Agreeing to a request **raises a consignment**, already in transit rather than
pending — the destination asking for it *was* the acceptance, and making them
accept their own request would be a handshake with themselves. A withdrawn or
refused consignment re-opens the request: nothing arrived, so the ask stands.

### 7 · Asking for a product

**`src/lib/actions/products.ts` · page `/stock/products`**

> An operator is booking goods in and the product is not in the catalog.

They raise a request from the entry form. Whoever can change the catalog reviews
it on the Catalog page, and **approving it is what creates the product** — there
is no separate step afterwards.

**A product code is two halves.** The category owns a fixed four-digit code; a
person types the rest. Pick Electronics (1004), the field shows `1004-` locked,
you type `TV55` → `1004-TV55`. That first half is never accepted from the
browser on the product form — the server re-reads it from the category.

**The category's own code is typed, never generated.** Whoever adds a category
chooses its four digits, and the form refuses one already in use. Approving
somebody's category *request* asks the reviewer for it too, since the request
carries only a name. Nothing allocates numbers in sequence: which code a
category gets is a decision about how the catalog is organised, not a counter.
The consequence to know about is that a category with no code cannot hand one
out — creating a product in one is refused with a message saying so, rather than
quietly inventing a code.

Someone who can add products directly sees **Create**, not **Request**.

---

## Undoing things

**Every deletion is recoverable for 30 days.** Deleting archives the row and
records what was unlinked on the way out, so restoring a vendor re-points the
stock entries that named it.

Deleting is always *offered* and always *steers to deactivating first* — a
deactivated product vanishes from the pickers and keeps all its history. Undo
appears on the toast for ten seconds, and in the Recycle Bin for the rest of the
month.

**Your bin is yours.** Without `recyclebin.scope.all` you see only what you
deleted yourself, which is what makes it safe to give to everybody.

Deleting a **person** does not destroy their history: their records are
re-pointed at a hidden system account, and every activity log line carries their
name as a snapshot, so searching a departed colleague still finds what they did.

---

## Passwords

**Nobody keeps a password somebody else chose.** When an admin creates an
account or resets a password, `mustChangePassword` is set on that person. The
next time they use the system they are sent to `/settings/password` and can
reach nothing else until they have replaced it — so the only person who knows
their password is them. Changing it signs them out, and they sign back in with
the new one.

Changing your own password is the one thing in the system behind **no permission
key at all** (`src/lib/actions/account.ts`). That is deliberate: an admin must
not be able to withhold someone's ability to stop using a password the admin
knows. Everything else about an account — name, email, role — stays admin-only.

The gate lives in exactly **one** place — `requireAuth()` in
`src/lib/rbac/check.ts` — and the interesting part is which way round it trusts
things: **the session may say no, but only the database may say yes.**

That asymmetry exists because a session is a snapshot. The jwt callback in
`src/auth.ts` re-reads the database only every 30 seconds, and `middleware.ts`
reads a cookie written once at sign-in and never rewritten. Either can therefore
go on claiming somebody still owes a password change after they have made one.

The two directions are not equally harmful, which is what decides the design. A
stale *no* merely delays an admin's reset by a few seconds. A stale *yes* locks
somebody out of the whole application — every page bounces them back to the
change form no matter what they do, for up to 30 seconds via the session and for
the full 24-hour cookie lifetime via middleware. That is why middleware no longer
checks it at all, and why a session claiming `true` is confirmed against the
database before anyone is redirected. The extra query happens only for the few
people actually carrying the flag.

The page itself uses `requireSignedIn()` rather than `requireAuth()`, or it
would redirect to itself.

---

## Running it

```bash
npm install
npx prisma migrate deploy     # create the schema
npm run db:seed               # ONLY on an empty database — it wipes first
npm run dev
```

| Command | Does |
|---|---|
| `npm run dev` | The app on http://localhost:3000 |
| `npm run build` | Production build — catches server/client boundary errors typecheck cannot |
| `npm run lint` | ESLint |
| `npm run db:seed` | Fills an **empty** database. Wipes first — never run it against real data |
| `npm run audit:access` | Finds pages that let a role in and then bounce it |
| `npm run docs:permissions` | Rewrites `permissions.md` from the database |
| `npm run docs:index` | Rebuilds the contents lists in this file and `summary.md` |

**Deploying it** is `docs/hosting.md`: a Dockerfile, a compose file, a
free-tier Vercel walkthrough, and the list of things that have to be true before
anyone outside the team can reach it. Uploaded documents go to Vercel Blob
(`src/app/api/upload/route.ts`), not to the local filesystem, so a host without
a persistent disk is fine — but `BLOB_READ_WRITE_TOKEN` has to be set or
uploading is the one flow that fails.

To change who can do what on a live database, edit
`prisma/setup-roles-and-people.ts` and run it — it is idempotent, and it is the
same definition the seed uses.

**Two things that will bite you on Windows:** stop the dev server before
`prisma generate`, because it holds the query engine DLL; and `prisma migrate
dev` is interactive and fails here — hand-write the SQL and use `migrate
deploy`.
