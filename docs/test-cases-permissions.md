# Test cases — every permission, every person

Companion to [`permissions.md`](../permissions.md) (what each role and each
person holds) and to [`test-cases-stock-approval.md`](./test-cases-stock-approval.md)
(the deep dive on one flow). This file is the **breadth** pass: all **105
permissions**, each one tried by somebody who holds it and somebody who does
not, plus a walkthrough per person.

## How to run these

Log in at `/login` as the named account. Three layers have to agree for every
permission, and each is a separate way the app can be wrong:

| Layer | Where it lives | What failure looks like |
| --- | --- | --- |
| **Sidebar** | `NAV_ITEMS` in `src/lib/constants.ts`, filtered in `src/components/layout/app-sidebar.tsx` | a nav item appears for someone the page then refuses |
| **Route** | `ROUTE_PERMISSIONS` in `middleware.ts` | typing the URL gets in where the sidebar hid the link |
| **Screen** | `has(PERMISSIONS.X)` on each page, passed down to components | a button that is visible but errors on click |
| **Action** | `requirePermission()` / `requireAnyPermission()` at the top of every server action in `src/lib/actions/` | the screen was bypassed and the write still happened |

**The rule being tested everywhere:** a capability someone lacks is **not
rendered at all**. Never greyed out, never disabled, never a button that fails.
If you find something disabled rather than absent, that is a defect — note it.

**Testing the fourth layer.** For the handful of cases where it matters, the
server action can be called directly from the browser console on a page the user
can open; the action must refuse even though no button offered it. Anywhere the
tables below say *"and the action refuses"*, that is what is meant.

**Two ways to test a permission nobody holds**, both from the Super Admin
account: grant it to one person temporarily from their profile
(`/users/<id>` → Grant Extra Permissions), or add it to a role at
`/roles/<id>`. Undo it afterwards. Grants are add-only and you can never grant a
permission you do not hold yourself.

---

## Run log — automated pass, 18 Aug 2026

> **Second run, after the fixes: 214 assertions, 0 failures.** Defects 1 and 2
> below are fixed, as are both latent mismatches and a third found while fixing
> them (department approval flows were losing to the company default, because
> Postgres sorts NULLs first on `DESC`). Defect 3 — the stuck entry — now has a
> recovery path in the app; see
> [`test-cases-stock-approval.md`](./test-cases-stock-approval.md) §B1a.
> Defect 4 remains open: it is a staffing decision, though a Hyderabad Central
> Stock Manager has since been created, which closes it.

### First run

What could be checked without signing in was checked mechanically, against the
live database and the real `NAV_ITEMS`, scope resolvers and `isStockVisible`:
**192 assertions passed, 18 failed**, and the failures are four distinct
defects, listed below. Everything that needs a session — whether a control is
absent rather than disabled, and the create → submit → approve round trip — is
still outstanding.

| Result | What was checked |
| --- | --- |
| **Pass** | Sidebar contents for all 10 active people (Part 1) — every list matches exactly |
| **Pass** | 190 nav-item × person pairs against the middleware route table, bar the four defects below |
| **Pass** | Stock scope, activity scope and recycle-bin scope for every person |
| **Pass** | Who sees each of the 14 stock entries (Ashish sees no Bengaluru stock; Manohar no Hyderabad; Nagarajan everything; Spandana only her own; Shravani has no route into stock at all) |
| **Pass** | `npm run audit:access` — no page admits a role and then bounces it |
| **Pass** | No permission is held by nobody; no empty role has members |
| **Fail** | **My Profile is unreachable for 8 of the 10 people** — see defect 1 |
| **Fail** | Builds is openable but never linked for 7 people — defect 2 |
| **Fail** | SE-20260814-001 still stuck in SUBMITTED with no approval step — defect 3 |
| **Fail** | Hyderabad has no on-site holder of `stock.approve` — defect 4 (staffing, not code) |

### Defect 1 — the sidebar offers My Profile to everyone; middleware refuses it

`src/app/(dashboard)/settings/profile/page.tsx` gates itself with `requireAuth()`
— every signed-in person, by design — and the nav item carries no permission at
all. But `middleware.ts` picks the longest matching prefix, and the only rule
matching `/settings/profile` is **`/settings`**, which demands `settings.view`.
Only Phani Raj and Shravani hold it, so the other eight are redirected to
`/unauthorized` by a link their own sidebar shows them.

Fix is one line — add `"/settings/profile": []`, or an explicit rule listing no
permission, ahead of the `/settings` entry so the longer prefix wins.
`npm run audit:access` does not catch this: it audits page gates per role, not
prefix collisions in the route table.

### Defect 2 — Builds: openable, never linked

The route rule and the page both accept `bom.view` (the page renders a read-only
build list without `bom.build`), but the nav item requires `bom.build` or
`bom.unbuild`. Ashish, Deepanjona, Manohar, Nagarajan, Raghava, Spandana and
Uday can therefore load `/builds` by URL while it never appears in their
sidebar. Safe direction — nothing is exposed that the page did not intend — but
the two lists should agree. Either add `bom.view` to the nav item so the
read-only list is discoverable, or drop `bom.view` from both the route and the
page.

### Defects 3 and 4

Both were already documented — the stuck entry in Part 0 and in
[`test-cases-stock-approval.md`](./test-cases-stock-approval.md) §B, the
Hyderabad approver gap as fact 0.1. The automated pass confirms both on live
data: the entry has **0 pending approval steps**, and the only person permitted
to approve at Hyderabad is the Super Admin.

### Two latent versions of defect 1, worth fixing at the same time

Neither affects anyone today, because no current person holds the odd
combination — but both are the same class of mismatch:

* **Stock Entries** — the route admits `stock.create`, the nav item requires
  `stock.view`. Someone with create-but-not-view would have access and no link.
* **Dispatch** — the nav item admits `dispatch.export`, the route does not list
  it. Someone with only `dispatch.export` would see the link and be bounced.

---

## Part 0 — Facts to check before anything else

These came out of reading the live database and are worth confirming first,
because several tests below will otherwise look like bugs.

| # | Fact | Why it matters |
| --- | --- | --- |
| 0.1 | **Nobody at Hyderabad holds `stock.approve`.** Kirubakaran is the only non-admin who holds it, and he sits in Bengaluru. | Goods arriving at Hyderabad can only ever be approved by the Super Admin. Not a code bug — a staffing gap. |
| 0.2 | **Everyone holds `recyclebin.view` and `recyclebin.restore`.** | There is no account to run the negative test with; temporarily remove the key from a role to test the absence. |
| 0.3 | **`stock.config.*` and `config.flows.bom` are held by the Super Admin alone.** | If that account is unavailable, no attachment type, entry field, approval flow or BOM flow can be changed by anyone. |
| 0.4 | **Shravani (Admin) has no `stock.view`.** | She is the right account for every "stock is invisible" negative test. |
| 0.5 | **Manohar is the only active person without `products.view`.** | He is the account for the catalog negative tests. |
| 0.6 | **Roles with nobody in them:** Buyer, Stock Approver, Builder are held only as *additional* roles (Kirubakaran holds all three); *Central Stock Manager* is retired — 0 permissions, 0 people. | Deleting or editing them affects only Kirubakaran. Central Stock Manager should not be assigned to anyone; it grants nothing. |
| 0.7 | **`Dispatch Blore` is deactivated.** | Use it for the "deactivated account cannot sign in" test (D-00 below) and ignore it everywhere else. |

---

## Part 1 — One walkthrough per person

For each account: sign in, and check the sidebar contains **exactly** the items
listed and none of the others. The lists below are derived from what each person
holds, so a mismatch is a real defect in either the nav gate or the role.

Then open two or three of the hidden routes by typing the URL — each must land
on `/unauthorized`, never on the page.

### W1 — Phani Raj (Super Admin) · `superadmin@straightdrivesport.com`

* Sidebar: **all 20 items** — Dashboard, Team Members, Roles, Departments, Stock
  Entries, Assets, Catalog, Vendors, Clients, Bills of Materials, Builds,
  Fulfilment, Procurement, Dispatch, Reports, Activity Log, Configuration,
  Recycle Bin, Settings, My Profile.
* Nothing is hidden anywhere; every table column, tab and button in this document
  should be present.
* Stock scope **all**; activity scope **all**; prices visible everywhere.

### W2 — Shravani (Admin) · `shravani@straightdrivesport.com`

* Sees (14): Dashboard, Team Members, Roles, Departments, Assets, Catalog,
  Vendors, Clients, Procurement, Activity Log, Configuration, Recycle Bin,
  Settings, My Profile.
* Hidden (6): **Stock Entries, Bills of Materials, Builds, Fulfilment, Dispatch,
  Reports**.
* Type `/stock`, `/reports`, `/dispatch` → each must redirect to `/unauthorized`.
* On Configuration she must see **only** the procurement flow card — the stock
  field/attachment/flow cards and the BOM flow card belong to keys she lacks.
* Activity log: sees everyone's actions, but only the catalog, people and buying
  categories — no stock, movement, making or security lines.

### W3 — Kirubakaran (Department Manager + Buyer + Stock Approver + Builder) · `kiruba@straightdrivesport.com`

* Sees (13): Dashboard, Team Members, Departments, Stock Entries, Assets,
  Vendors, Bills of Materials, Builds, Fulfilment, Procurement, Activity Log,
  Recycle Bin, My Profile.
* Hidden (7): **Roles, Catalog, Clients, Dispatch, Reports, Configuration,
  Settings**.
* The clearest demonstration that roles add up: Builds comes from *Builder*,
  Procurement from *Buyer*, the approval card on stock from *Stock Approver*,
  and everything else from *Department Manager*.
* Stock scope is **location** (Bengaluru), not department — `stock.scope.location`
  from Stock Approver/Builder outranks `stock.scope.department`. He therefore
  sees other Bengaluru departments' stock, which a plain Department Manager does
  not. Confirm this deliberately.
* No prices anywhere (`stock.value.view` absent), including on stock he approves.

### W4 — Manohar (Department Manager) · `manu@straightdrivesport.com`

* Sees (11): Dashboard, Team Members, Departments, Stock Entries, Assets, Bills
  of Materials, Fulfilment, Procurement, Activity Log, Recycle Bin, My Profile.
* Hidden (9): **Roles, Catalog, Vendors, Clients, Builds, Dispatch, Reports,
  Configuration, Settings**.
* Stock scope **department** (R&D) plus Bengaluru central stock. He must never
  see Production's or any Hyderabad holdings.
* Compare against W3 side by side: same base role, very different screen,
  because of the three extra roles Kirubakaran holds.

### W5 — Nagarajan (Auditor + Buyer) · `nagarajan@straightdrivesport.com`

* Sees (16): everything except **Roles, Builds, Configuration, Settings**.
* Stock scope **all** *and* `stock.value.view` — the only non-admin who sees the
  money. Every price, total and report value must be visible.
* But he cannot create or approve stock entries: no Book In button, no approval
  card, anywhere.

### W6 — Spandana (Stock Entry Operator) · `spandana@straightdrivesport.com`

* Sees (7): Dashboard, Stock Entries, Catalog, Bills of Materials, Procurement,
  Recycle Bin, My Profile.
* Hidden (13) including **Assets, Fulfilment, Dispatch, Activity Log**.
* Stock scope **own** — the stock list contains only entries she created, even
  though other people's entries exist at her site.
* She sees prices (`stock.value.view`) and can set a batch number
  (`stock.batch.edit`) and warranty details.

### W7 — Uday Kherkatary (Stock Entry Operator + Dispatch Operator) · `uday@straightdrivesport.com`

* Sees (9): Spandana's list plus **Fulfilment** and **Dispatch**.
* Stock scope **location** (Bengaluru) — the second role widens `own` to the
  whole site. Directly comparable to W6: same base role, more visible stock.

### W8 — Ashish (Dispatch Operator) · `ashish@straightdrivesport.com`

* Sees (7): Dashboard, Stock Entries, Bills of Materials, Fulfilment, Dispatch,
  Recycle Bin, My Profile.
* Hidden (13) including **Assets, Catalog, Procurement, Activity Log**.
* Stock scope **location** = Hyderabad. He must not see Bengaluru stock at all.
* No approval card on Hyderabad entries — see fact 0.1.

### W9 — Deepanjona (Engineer, Production) · `deepanjona@straightdrivesport.com`

* Sees (9): Dashboard, Stock Entries, Assets, Catalog, Bills of Materials,
  Fulfilment, Procurement, Recycle Bin, My Profile.
* On Catalog she may only **ask** for a product or category; no Add Product, no
  Add Category, no approve queue.
* No prices, no warranty details, no dispatch, no activity log.

### W10 — Raghava (Engineer, R&D) · `raghava@straightdrivesport.com`

* Identical permission set to W9 — same 16 keys, same sidebar. The difference is
  **which stock they see**: Raghava sees R&D's, Deepanjona sees Production's.
  Run both and compare the stock lists; any overlap other than Bengaluru central
  stock is a scoping defect.

### D-00 — A deactivated account cannot sign in

Try `dispatchblore@straightdrivesport.com`. Sign-in must fail, regardless of the
permissions the role still carries (`src/auth.ts` checks `isActive`).

---

## Part 2 — Every permission, one by one

Each row: what to do, what the holder must get, and who to log in as to confirm
the capability is **absent** rather than disabled. Where a row says "action
refuses", also confirm the server-side gate.

### Stock — 16 keys

Pages: `/stock`, `/stock/new`, `/stock/[id]`, `/stock/[id]/edit`, `/configure`.

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `stock.view` | Open `/stock` | The list renders, narrowed by scope | **Shravani** — no Stock Entries nav, `/stock` → `/unauthorized` |
| `stock.create` | Open `/stock`, look for Book In / New Entry | Button present, `/stock/new` opens | **Kirubakaran** — no button; `/stock/new` refuses |
| `stock.edit` | Open a DRAFT or REJECTED entry you created | Edit button present | **Manohar** — no Edit on any entry |
| `stock.approve` | Open a SUBMITTED entry at your site | Amber Action Required card with Approve / Reject | **Manohar**, **Spandana** — no card at all |
| `stock.move` | Open an APPROVED central entry with quantity left | Move to Department is offered | **Spandana** — offered a transfer *request* instead, or nothing |
| `stock.value.view` | Look at any entry and the stock list | Unit price, total and value columns visible | **Kirubakaran** — quantities only; no price column, no total, no value tile |
| `stock.batch.edit` | Open `/stock/new` | Batch number field is present and saves | **Kirubakaran** (grant `stock.create` temporarily) — field absent, and a batch posted directly is ignored by the action |
| `stock.warranty.view` | Open an entry with warranty details | Warranty card shows purchase date, model, serial, expiry | **Deepanjona** — card absent |
| `stock.warranty.edit` | Open `/stock/new` or edit a draft | Warranty fields are editable | **Kirubakaran** — read-only or absent |
| `stock.scope.all` | Open `/stock` | Every entry, both sites | **Ashish** — Hyderabad only |
| `stock.scope.location` | Open `/stock` as Ashish | Every Hyderabad department + Hyderabad central | Compare with **Manohar** (department scope) |
| `stock.scope.department` | Open `/stock` as Manohar | R&D's stock + Bengaluru central stock still worth acting on | Compare with **Raghava** — different department, different list |
| `stock.scope.own` | Open `/stock` as Spandana | Only entries she created | Compare with **Uday**, same base role, whole site |
| `stock.config.fields` | `/configure` → entry fields card | Card present, a custom field can be added and then appears on `/stock/new` | **Shravani** — card absent though she can open `/configure` |
| `stock.config.attachments` | `/configure` → attachment types card | Card present; marking a type required blocks submit until it is uploaded | **Shravani** — card absent |
| `stock.config.flows` | `/configure` → approval flows card | Card present; steps can be added and removed | **Shravani** — card absent |

### Team members — 7 keys

Pages: `/users`, `/users/new`, `/users/[id]`.

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `users.view` | Open `/users` | List and profiles readable | **Spandana** — no nav item, route refuses |
| `users.create` | `/users` → Add | Button present, `/users/new` opens | **Kirubakaran** — button absent |
| `users.edit` | Open a profile | Edit is offered | **Manohar** — read-only profile |
| `users.delete` | Open a profile | Deactivate is offered, and offers deactivation *before* deletion | **Nagarajan** — absent |
| `users.password.edit` | Open a profile | Set a new password | **Nagarajan** — absent |
| `users.password.view` | Open a profile | Reveal password (only for passwords set in-app) | **Nagarajan** — no reveal control |
| `users.permissions.grant` | Open a profile | Grant Extra Permissions; only keys the granter holds are offered, and never on your own profile | **Kirubakaran** — absent. As **Shravani**, confirm she cannot grant `stock.approve` (she does not hold it) |

### Roles & permissions — 4 keys

Pages: `/roles`, `/roles/[id]`.

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `roles.view` | Open `/roles` | Role list readable | **Kirubakaran** — no nav, route refuses |
| `roles.create` | `/roles` → New Role | Present | **Nagarajan** |
| `roles.edit` | Open a role → the permission editor | Checkboxes save; linked-permission prompts appear | **Nagarajan** |
| `roles.delete` | Open a role | Delete offered, and refused for a protected system role (Super Admin) | **Nagarajan** |

Also confirm: **nobody but a Super Admin may edit the Super Admin role or
account**, even holding `roles.edit` — as **Shravani**, the Super Admin role must
be protected.

### Departments — 4 keys

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `departments.view` | Open `/departments` | List readable | **Spandana** |
| `departments.create` | Add Department | Present | **Kirubakaran** |
| `departments.edit` | Open a department | Edit present | **Manohar** |
| `departments.delete` | Open a department | Delete offered, steering to deactivate first | **Nagarajan** |

### Product catalog — 14 keys

Page: `/stock/products` (Catalog).

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `products.view` | Open the catalog, search a product | Catalog searchable; product pickers on other screens populate | **Manohar** — the only active person without it |
| `products.create` | Add → raw material | Form accepts a bought-in material | **Deepanjona** — only "ask for" is offered |
| `products.create.made` | Add → finished product | Form accepts a made product | **Deepanjona** |
| `products.edit` | Open a product | Rename, recode, activate/deactivate | **Spandana** |
| `products.delete` | Open a product | Delete offered after steering to deactivate | **Nagarajan** — absent |
| `products.code.override` | Add a product | The generated code can be typed over by hand | **Nagarajan** — code is fixed from the category prefix |
| `products.request.create` | Catalog → ask for a product | Request form present, request appears in the queue | **Kirubakaran** |
| `products.request.approve` | Catalog → requests queue | Approve/decline; approving creates the product | **Deepanjona** — queue not shown |
| `categories.create` | Add a category | Present | **Deepanjona** |
| `categories.edit` | Rename a category | Present | **Deepanjona** |
| `categories.delete` | Delete a category | Offered, steering to deactivate | **Nagarajan** |
| `categories.prefix.edit` | Open a category | The 4-digit code prefix is editable | **Nagarajan** — prefix shown but fixed |
| `categories.request.create` | Ask for a category | Request form present | **Kirubakaran** |
| `categories.request.approve` | Requests queue | Approve/decline; approving creates the category | **Deepanjona** |

### Assets — 4 keys

Page: `/assets`.

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `assets.view` | Open `/assets` | Holdings list readable | **Spandana** — no nav, route refuses |
| `assets.create` | New Asset | Present | **Deepanjona** |
| `assets.transfer.request` | Ask for central stock into your department | Request form; it lands in the department manager's queue | **Nagarajan** |
| `assets.transfer.approve` | Transfer queue | Agree/decline — and agreeing IS the movement, so check the stock actually moves | **Deepanjona** — queue absent |

### Bills of materials — 9 keys

Pages: `/bom`, `/bom/[productId]`, `/builds`.

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `bom.view` | Open `/bom` | Component lists and versions readable | **Shravani** — no nav, route refuses |
| `bom.create` | Write a BOM and submit it | Editor present; submitted, not published, unless they also hold `bom.publish` | **Ashish** |
| `bom.edit` | Correct the version in force; restore an older one | Present | **Deepanjona** |
| `bom.approve` | Approve a submitted BOM | Approves and publishes — **and approving your own work is refused** (`SELF_APPROVAL_REFUSAL`) | **Deepanjona**. Also as **Manohar**: submit one himself, then confirm he cannot approve it |
| `bom.publish` | Write a BOM | It publishes immediately, no approval step | **Deepanjona** — hers waits for approval |
| `bom.delete` | Open an old version | Delete offered, and refused for any version something was built to | **Kirubakaran** — Super Admin only |
| `bom.build` | Start a build from a BOM | Components come out of central stock | **Manohar** — no Builds nav |
| `bom.build.finish` | Finish a run, in whole or in part | Finished goods book into stock | **Manohar** |
| `bom.unbuild` | Undo a build | Components return; refused once anything has moved or been dispatched from the output | **Manohar** |

### Dispatch — 5 keys

Page: `/dispatch`.

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `dispatch.view` | Open `/dispatch` | Consignments in and out for their site; batch numbers traceable | **Manohar** |
| `dispatch.create` | Raise a consignment | Central stock at their site can be sent to another site or a client | **Kirubakaran** |
| `dispatch.accept` | Open an arriving consignment | Accept/reject — **and the person who raised it may not answer it** | **Manohar**. Also as **Uday**: raise one, confirm he cannot accept his own |
| `dispatch.receive` | Confirm delivery | Books into central stock at the destination; **this one is allowed for the requester** | **Manohar** |
| `dispatch.export` | Dispatch report | Export CSV present | **Manohar** |

### Fulfilment — 3 keys

Page: `/fulfilment`.

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `fulfilment.view` | Open `/fulfilment` | Which sites hold the stock, what could be built | **Shravani** |
| `fulfilment.request` | Ask another site for stock | Request form present | **Nagarajan** |
| `fulfilment.approve` | Answer an incoming request | Agree raises a dispatch from this site; **the requester may not answer their own** | **Manohar** — no answer control |

### Procurement — 7 keys

Page: `/procurement`.

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `procurement.intent.view` | Open `/procurement` | Stated needs and their outcomes | **Ashish** — no nav, route refuses |
| `procurement.intent.create` | State a need; withdraw your own | Both present | **Ashish** |
| `procurement.intent.approve` | Verify or decline a need | Present | **Manohar** |
| `procurement.po.view` | Orders tab | Orders and outstanding quantities | **Ashish** |
| `procurement.po.create` | Raise an order | Quantities and agreed prices | **Manohar** |
| `procurement.po.close` | Close an order short; cancel an empty one | Present | **Manohar** |
| `procurement.value.view` | Open any order | Unit prices and totals visible | **Manohar** — quantities only |

### Clients — 5 keys · Vendors — 5 keys

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `clients.view` | Open `/clients` | List; GST and address on outgoing stock | **Kirubakaran** |
| `clients.create` / `clients.edit` | Add / edit a client | Present | **Kirubakaran** |
| `clients.delete` | Delete a client | Offered, steering to deactivate | **Nagarajan** |
| `clients.export` | Export CSV | Download with GST and addresses | **Kirubakaran** |
| `vendors.view` | Open `/vendors` | List with GST and address | **Manohar** |
| `vendors.create` / `vendors.edit` | Add / edit a vendor | Present | **Kirubakaran** (he can view only) |
| `vendors.delete` | Delete a vendor | Offered, steering to deactivate | **Nagarajan** |
| `vendors.export` | Export CSV | Download | **Kirubakaran** |

### Reports — 2 keys · Settings — 2 keys · Configuration — 2 keys

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `reports.view` | Open `/reports` | Stock reports render, respecting stock scope and `stock.value.view` | **Kirubakaran** — no nav, route refuses |
| `reports.export` | Export a report | CSV downloads | **Kirubakaran** |
| `settings.view` | Open `/settings` | Settings readable | **Nagarajan** |
| `settings.edit` | Change a setting | Saves | **Nagarajan** |
| `config.flows.bom` | `/configure` → BOM approval flow card | Set whether a BOM needs approval and by which role; only roles that hold `bom.approve` may be chosen | **Shravani** — card absent |
| `config.flows.procurement` | `/configure` → procurement flow card | Set whether a need must be verified before ordering | **Kirubakaran** — no Configuration nav at all |

### Recycle bin — 5 keys

Page: `/recycle-bin`. Note fact 0.2 — everybody holds view and restore today.

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `recyclebin.view` | Open `/recycle-bin` | Recently deleted records, and who deleted them | temporarily remove from the Engineer role, then **Raghava** |
| `recyclebin.restore` | Restore a record | It comes back, along with whatever was unlinked when it went | same method |
| `recyclebin.purge` | Remove for good | Offered, with a clear warning | **Kirubakaran** — absent |
| `recyclebin.scope.all` | Open the bin as **Shravani** | Everyone's deletions | — |
| `recyclebin.scope.own` | Open the bin as **Spandana** | Only what she deleted; delete something as Uday and confirm it does not appear for her | — |

### Activity log — 11 keys

Page: `/activity`.

| Key | What to do | Holder must | Absent — test as |
| --- | --- | --- | --- |
| `activity.view` | Open `/activity` | The page opens; contents depend on the category keys below | **Ashish** — no nav, route refuses |
| `activity.view.stock` | Filter to stock | Entries, documents and approvals visible | **Nagarajan** — those lines missing |
| `activity.view.movement` | Filter to stock out | Issues, transfers, dispatches | **Nagarajan** |
| `activity.view.making` | Filter to making | BOMs and builds | **Nagarajan** |
| `activity.view.catalog` | Filter to catalog | Products, categories, vendors, clients | **Kirubakaran** |
| `activity.view.people` | Filter to people | Team members, roles, departments, sites | **Nagarajan** |
| `activity.view.procurement` | Filter to buying | Needs and purchase orders | **Manohar** |
| `activity.view.security` | Filter to security | Password reveals, permission grants, deletions, config changes | **Shravani** — the most sensitive part must be missing for her, and the filter itself not offered |
| `activity.scope.all` | Open the log as **Shravani** | Everyone's actions | — |
| `activity.scope.department` | Open the log as **Manohar** | R&D members' actions, and actions done to them | — |
| `activity.scope.own` | Remove the other two scope keys from a test role | Only their own actions | — |

A good combined check: as **Manohar**, do something in stock and have Nagarajan
do something in procurement. Manohar must see his own stock line and not
Nagarajan's procurement line — narrowed by both *what* and *whose*.

---

## Part 3 — Cross-cutting scenarios

These are where permissions interact, and where the bugs usually live.

| ID | Scenario | Expected |
| --- | --- | --- |
| X1 | **Roles add up.** Compare Spandana (Stock Entry Operator) with Uday (same + Dispatch Operator). | Uday sees strictly more; nothing is subtracted by holding a second role. |
| X2 | **The widest scope wins.** Kirubakaran holds both `stock.scope.department` and `stock.scope.location`. | He gets **location**. Check he sees other Bengaluru departments' stock. |
| X3 | **Same role, different data.** Deepanjona and Raghava hold identical keys in different departments. | Their stock lists must not overlap except on Bengaluru central stock. |
| X4 | **Money is a separate switch.** Nagarajan (all stock + value) vs Kirubakaran (approves stock, no value). | Kirubakaran approves entries whose price he never sees; no price leaks into approval screens, reports or exports for him. |
| X5 | **Grants are add-only and never self-serving.** As Shravani, try to grant yourself a permission, and to grant `stock.approve` (which she lacks). | Both impossible: no self-grant, and only keys the granter holds are offered. |
| X6 | **A permission change lands without signing out.** As Super Admin, grant Manohar `reports.view`; wait ~30 seconds and refresh Manohar's session. | Reports appears in his sidebar (`src/auth.ts` re-reads the user every 30s). |
| X7 | **Removing a permission takes a capability away cleanly.** Remove `stock.move` from Department Manager while Manohar is signed in. | Within ~30s the Move control disappears, and the action refuses if called directly. |
| X8 | **Deactivating a person ends access.** Deactivate a test account while it is signed in. | Next request bounces to login; their history stays readable under their name. |
| X9 | **Nav, route and page agree.** For each person in Part 1, take one hidden item and type its URL. | Always `/unauthorized`; never a rendered page, never a crash. |
| X10 | **Self-approval rules, where they apply.** BOM approval, dispatch accept and fulfilment answer refuse the raiser; **stock entry approval does not**. | Confirm each — and note that the stock exception is deliberate today (see the stock approval test file). |

---

## Part 4 — Result sheet

One row per permission. Fill in Pass/Fail and note anything that was disabled
rather than absent.

| Key | Holder tested | Absence tested | Result | Notes |
| --- | --- | --- | --- | --- |
| `activity.scope.all` | Shravani | Manohar | | |
| `activity.scope.department` | Manohar | Nagarajan | | |
| `activity.scope.own` | (test role) | — | | |
| `activity.view` | Nagarajan | Ashish | | |
| `activity.view.catalog` | Shravani | Kirubakaran | | |
| `activity.view.making` | Manohar | Nagarajan | | |
| `activity.view.movement` | Manohar | Nagarajan | | |
| `activity.view.people` | Shravani | Nagarajan | | |
| `activity.view.procurement` | Nagarajan | Manohar | | |
| `activity.view.security` | Phani Raj | Shravani | | |
| `activity.view.stock` | Manohar | Nagarajan | | |
| `assets.create` | Manohar | Deepanjona | | |
| `assets.transfer.approve` | Manohar | Deepanjona | | |
| `assets.transfer.request` | Raghava | Nagarajan | | |
| `assets.view` | Deepanjona | Spandana | | |
| `bom.approve` | Manohar | Deepanjona | | |
| `bom.build` | Kirubakaran | Manohar | | |
| `bom.build.finish` | Kirubakaran | Manohar | | |
| `bom.create` | Raghava | Ashish | | |
| `bom.delete` | Phani Raj | Kirubakaran | | |
| `bom.edit` | Manohar | Deepanjona | | |
| `bom.publish` | Manohar | Deepanjona | | |
| `bom.unbuild` | Kirubakaran | Manohar | | |
| `bom.view` | Ashish | Shravani | | |
| `categories.create` | Nagarajan | Deepanjona | | |
| `categories.delete` | Shravani | Nagarajan | | |
| `categories.edit` | Nagarajan | Deepanjona | | |
| `categories.prefix.edit` | Shravani | Nagarajan | | |
| `categories.request.approve` | Nagarajan | Deepanjona | | |
| `categories.request.create` | Deepanjona | Kirubakaran | | |
| `clients.create` | Nagarajan | Kirubakaran | | |
| `clients.delete` | Shravani | Nagarajan | | |
| `clients.edit` | Nagarajan | Kirubakaran | | |
| `clients.export` | Nagarajan | Kirubakaran | | |
| `clients.view` | Nagarajan | Kirubakaran | | |
| `config.flows.bom` | Phani Raj | Shravani | | |
| `config.flows.procurement` | Shravani | Kirubakaran | | |
| `departments.create` | Shravani | Kirubakaran | | |
| `departments.delete` | Shravani | Nagarajan | | |
| `departments.edit` | Shravani | Manohar | | |
| `departments.view` | Manohar | Spandana | | |
| `dispatch.accept` | Uday | Manohar | | |
| `dispatch.create` | Ashish | Kirubakaran | | |
| `dispatch.export` | Nagarajan | Manohar | | |
| `dispatch.receive` | Uday | Manohar | | |
| `dispatch.view` | Ashish | Manohar | | |
| `fulfilment.approve` | Uday | Manohar | | |
| `fulfilment.request` | Deepanjona | Nagarajan | | |
| `fulfilment.view` | Ashish | Shravani | | |
| `procurement.intent.approve` | Nagarajan | Manohar | | |
| `procurement.intent.create` | Spandana | Ashish | | |
| `procurement.intent.view` | Spandana | Ashish | | |
| `procurement.po.close` | Kirubakaran | Manohar | | |
| `procurement.po.create` | Nagarajan | Manohar | | |
| `procurement.po.view` | Uday | Ashish | | |
| `procurement.value.view` | Nagarajan | Manohar | | |
| `products.code.override` | Shravani | Nagarajan | | |
| `products.create` | Nagarajan | Deepanjona | | |
| `products.create.made` | Nagarajan | Deepanjona | | |
| `products.delete` | Shravani | Nagarajan | | |
| `products.edit` | Nagarajan | Spandana | | |
| `products.request.approve` | Nagarajan | Deepanjona | | |
| `products.request.create` | Deepanjona | Kirubakaran | | |
| `products.view` | Spandana | Manohar | | |
| `recyclebin.purge` | Shravani | Kirubakaran | | |
| `recyclebin.restore` | Spandana | (test role) | | |
| `recyclebin.scope.all` | Shravani | Spandana | | |
| `recyclebin.scope.own` | Spandana | — | | |
| `recyclebin.view` | Spandana | (test role) | | |
| `reports.export` | Nagarajan | Kirubakaran | | |
| `reports.view` | Nagarajan | Kirubakaran | | |
| `roles.create` | Shravani | Nagarajan | | |
| `roles.delete` | Shravani | Nagarajan | | |
| `roles.edit` | Shravani | Nagarajan | | |
| `roles.view` | Shravani | Kirubakaran | | |
| `settings.edit` | Shravani | Nagarajan | | |
| `settings.view` | Shravani | Nagarajan | | |
| `stock.approve` | Kirubakaran | Manohar | | |
| `stock.batch.edit` | Spandana | Kirubakaran | | |
| `stock.config.attachments` | Phani Raj | Shravani | | |
| `stock.config.fields` | Phani Raj | Shravani | | |
| `stock.config.flows` | Phani Raj | Shravani | | |
| `stock.create` | Spandana | Kirubakaran | | |
| `stock.edit` | Spandana | Manohar | | |
| `stock.move` | Manohar | Spandana | | |
| `stock.scope.all` | Nagarajan | Ashish | | |
| `stock.scope.department` | Manohar | — | | |
| `stock.scope.location` | Ashish | — | | |
| `stock.scope.own` | Spandana | — | | |
| `stock.value.view` | Nagarajan | Kirubakaran | | |
| `stock.view` | Ashish | Shravani | | |
| `stock.warranty.edit` | Spandana | Kirubakaran | | |
| `stock.warranty.view` | Manohar | Deepanjona | | |
| `users.create` | Shravani | Kirubakaran | | |
| `users.delete` | Shravani | Nagarajan | | |
| `users.edit` | Shravani | Manohar | | |
| `users.password.edit` | Shravani | Nagarajan | | |
| `users.password.view` | Shravani | Nagarajan | | |
| `users.permissions.grant` | Shravani | Kirubakaran | | |
| `users.view` | Manohar | Spandana | | |
| `vendors.create` | Nagarajan | Kirubakaran | | |
| `vendors.delete` | Shravani | Nagarajan | | |
| `vendors.edit` | Nagarajan | Kirubakaran | | |
| `vendors.export` | Nagarajan | Kirubakaran | | |
| `vendors.view` | Kirubakaran | Manohar | | |

105 keys. Walkthroughs W1–W10 and D-00, cross-cutting X1–X10, and Parts 0.1–0.7
are recorded separately in whatever form suits — a line each is enough.

---

## Part 5 — Stock list filters

Added 18 Aug 2026. The filters narrow what you can already see, so they carry
**no permission keys of their own** — but they must never widen anything, and
they must never offer a choice that returns nothing.

| ID | Scenario | Expected |
| --- | --- | --- |
| FL1 | As **Ashish** (Hyderabad, one site, one category, no assets) open `/stock` | Only the **kind** and **how it arrived** dropdowns render. No site dropdown — he has one site; no category — his entries share one; no stock/assets — he holds no assets. |
| FL2 | As **Phani Raj** or **Nagarajan** (every site) | Four dropdowns: kind, how it arrived, category, site. |
| FL3 | As **Spandana** (scope `own`, no entries of her own) | No dropdowns at all, and an empty table. |
| FL4 | Filter, then read the URL | `/stock?site=loc_hyderabad&source=TRANSFERRED`. Paste it into another browser signed in as someone else and it opens the same view — **narrowed by their own scope**, never widened. |
| FL5 | Open a URL with a nonsense value (`?kind=BANANA`) | Falls back to no filter, never an empty table with no explanation. |
| FL6 | Combine filters | They compose with AND, and "Showing 3 of 9" counts against the current status tab, not the whole company. |
| FL7 | Press Clear | Every dropdown resets and the query string disappears from the URL. |
| FL8 | Filter, wait 30 seconds for the auto-refresh | The filters survive — they are client state, and the refresh replaces server data underneath them. |
| FL9 | Back button after several filter changes | Leaves the page. Filter changes use `replace`, so they do not fill the history. |

**Two notes from the live data when this shipped:** no entry is an asset yet, so
the stock/assets dropdown is hidden for everyone until one exists — it is built
and will appear on its own. And three entries hold `KIT` products even though
`schema.prisma` describes a kit as never stocked; worth deciding which is right.
