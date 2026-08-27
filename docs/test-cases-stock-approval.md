# Test cases — stock entry approval

What this covers: the path a stock entry takes from being created to being
approved or rejected, and every rule that decides **who** may sign it off.

Code under test:

| Piece | File |
| --- | --- |
| Create / submit / approve / reject actions | `src/lib/actions/stock.ts` (`createStockEntry`, `submitStockEntry`, `approveStockEntry`, `rejectStockEntry`) |
| Who may act on an entry | `approvalRefusal()` in `src/lib/actions/stock.ts:472` |
| The Approve / Reject card | `src/app/(dashboard)/stock/_components/approval-actions.tsx` |
| Whether that card renders at all | `canApprove` in `src/app/(dashboard)/stock/_components/stock-entry-detail.tsx:173` |
| The approval queue on the dashboard | `getPendingApprovals()` in `src/lib/actions/dashboard.ts:134` |
| Who may see the entry in the first place | `src/lib/stock-visibility.ts` |

The breadth pass — all 105 permissions, every person, every module — is
[`test-cases-permissions.md`](./test-cases-permissions.md). This file goes deep
on one flow instead; where the two overlap, this one is the more detailed.

---

## What was found while writing these (read first)

**The reported symptom is real, but it is not a self-approval rule.** There is
no "you raised it, so you cannot answer it" check anywhere in the stock flow —
`SELF_APPROVAL_REFUSAL` (`src/lib/review-rules.ts`) is used by dispatch,
fulfilment and bills of materials, and deliberately not by stock entries. A
Super Admin approving an entry they created is allowed by the code as it stands.

What actually blocks entry **SE-20260814-001** (the Hyderabad BLDC MOTOR entry)
is that it sits in `SUBMITTED` with **zero rows in `stock_approvals`**:

* `ApprovalActions` looks for the first `PENDING` step and returns `null` when
  there is none — so the Approve / Reject card is never rendered, for anybody,
  including the Super Admin. Nothing is greyed out; it simply is not there.
* Calling `approveStockEntry` directly would return `"Approval step not found"`.
* The entry cannot be edited (`updateStockEntry` allows only DRAFT/REJECTED),
  cannot be resubmitted (`submitStockEntry` allows only DRAFT), and cannot be
  rejected (same missing-step check). It is stuck permanently.

Two further facts from the database that matter for the tests below:

1. That entry has a `CREATED` activity log at `08:14:32` but **no `SUBMITTED`
   log**, while its `updatedAt` moved at `08:15:04`. So its status was changed
   outside the app (Prisma Studio or a script), which is why the snapshot of
   approval steps was never written. Submitting through the app today does write
   the step — verified against the live database with a throwaway entry.
2. The entry arrived at **Hyderabad**, and no Hyderabad user holds
   `stock.approve`. Kirubakaran is the only non-admin who holds it (via the
   *Stock Approver* role) and he sits in Production, **Bengaluru**, so
   `approvalRefusal` would answer *"Those goods arrived at another site"* even
   if the step row existed. Today only the Super Admin can approve anything at
   Hyderabad.

So the test set below deliberately separates three questions that the single
symptom mixed together: *may this person approve*, *is there a step to approve*,
and *is anyone staffed to approve at that site*.

---

## Accounts used

Passwords are whatever is set locally; log in at `/login`.

| Account | Role(s) | Department / Site | Holds `stock.approve` | Stock scope |
| --- | --- | --- | --- | --- |
| `superadmin@straightdrivesport.com` (Phani Raj) | Super Admin | — (no department) | yes | all |
| `kiruba@straightdrivesport.com` (Kirubakaran) | Department Manager + Buyer + **Stock Approver** + Builder | Production, Bengaluru | yes | department |
| `spandana@straightdrivesport.com` (Spandana) | Stock Entry Operator | Central Stock — Bengaluru | no | location |
| `uday@straightdrivesport.com` (Uday) | Stock Entry Operator + Dispatch Operator | Central Stock — Bengaluru | no | location |
| `manu@straightdrivesport.com` (Manohar) | Department Manager | R&D, Bengaluru | no | department |
| `nagarajan@straightdrivesport.com` (Nagarajan) | Auditor + Buyer | Accounts, Bengaluru | no | all (view only) |
| `ashish@straightdrivesport.com` (Ashish) | Dispatch Operator | Dispatch Hyd, Hyderabad | no | location |
| `deepanjona@straightdrivesport.com` (Deepanjona) | Engineer | Production, Bengaluru | no | department |
| `raghava@straightdrivesport.com` (Raghava) | Engineer | R&D, Bengaluru | no | department |

Active approval flow: **Default Approval Flow**, one step — *"Site stock
approval"*, approver role *Stock Approver* (`approval_flow_configs` /
`approval_flow_steps`).

Handy database check used repeatedly below (run from the project root):

```bash
npx prisma studio          # or query stock_approvals for the entry id
```

---

## A. The reported scenario — Super Admin creates and approves

### A1 — Super Admin submits their own entry and the step is snapshotted

*Fixes the ambiguity in the bug report: does submitting actually write the step?*

1. Log in as **Phani Raj** (Super Admin).
2. Go to `/stock/new`, fill in product, vendor, quantity, price and a **site of
   Bengaluru**, then press **Submit for Approval**.
3. Open the new entry from `/stock`.

**Expected**

* Status badge reads `SUBMITTED`.
* The amber **Action Required** card is visible, showing *Pending: Site stock
  approval*.
* `stock_approvals` has exactly one row for this entry: `stepOrder 1`,
  `stepLabel "Site stock approval"`, `status PENDING`.
* The activity log has a `SUBMITTED` line for the entry.

### A2 — Super Admin approves the entry they created themselves

*The headline claim from the bug report.*

1. Continue from A1, still logged in as the Super Admin.
2. Press **Approve** on the Action Required card.

**Expected**

* Toast *"Entry approved successfully"*, page refreshes.
* Status becomes `APPROVED`, `approvedById` is the Super Admin.
* The approval row moves to `APPROVED` with `approverUserId` = Super Admin.
* **No self-approval refusal.** If instead an error appears saying the raiser
  cannot answer their own entry, that is a change of behaviour, not the current
  code — report it.

### A3 — Someone else approves the Super Admin's entry

1. As Super Admin, create and submit a new entry with site **Bengaluru** and no
   department (central stock).
2. Log out; log in as **Kirubakaran** (holds Stock Approver, Bengaluru).
3. Open the entry from `/stock` or from the dashboard approval queue.

**Expected**

* The entry is visible to him (central stock at his own site, still actionable).
* The Action Required card is shown and **Approve** succeeds.

### A4 — Super Admin's Hyderabad entry, with nobody staffed there

*This is what made the reported entry look unapprovable even to other people.*

1. As Super Admin, create and submit an entry with site **Hyderabad**.
2. Log in as **Ashish** (Hyderabad, Dispatch Operator).
3. Log in as **Kirubakaran** (Bengaluru, Stock Approver).

**Expected**

* Ashish: may see the entry, but **no** Approve / Reject card — he has no
  `stock.approve`.
* Kirubakaran: entry is not in his approval queue; if he opens it by URL the
  card may render, and pressing Approve must fail with *"Those goods arrived at
  another site, so someone there has to approve them"*.
* Super Admin: can approve it (scope `all`).
* Conclusion to record: Hyderabad has no approver of its own. Decide whether to
  grant *Stock Approver* to a Hyderabad user — a data/roster fix, not a code fix.

---

## B. The stuck entry — SUBMITTED with no approval step

### B1 — Reproduce the dead end (regression test for the reported bug)

1. Pick or create an entry in `SUBMITTED`, then delete its rows from
   `stock_approvals` (Prisma Studio), simulating the state SE-20260814-001 is
   in. **Do this on a scratch entry, not on real data.**
2. Open the entry as the **Super Admin**.

**Expected today (current, broken behaviour)**

* No Action Required card at all; nothing explains why.
* Edit is not offered (status is not DRAFT/REJECTED).
* The entry still counts as pending on the dashboard and in `/stock` filters.

**Expected after the fix (implemented 18 Aug 2026)**

* Anyone who would be allowed to approve the entry sees a **"No approval steps
  recorded"** card explaining that the steps were never written, that changing
  the approval flow cannot reach it, and offering **Restore approval steps**.
* Pressing it copies the steps from the flow in force today
  (`rebuildApprovalSteps` in `src/lib/actions/stock.ts`), logs the action, and
  the normal Approve / Reject card appears in its place.

### B1a — The restore path itself

1. Take a scratch `SUBMITTED` entry and delete its `stock_approvals` rows.
2. Open it as someone who may approve it → press **Restore approval steps**.
3. Open the same entry as someone who may *not* approve it (wrong site, or no
   `stock.approve`).

**Expected**

* The restore succeeds and the entry becomes approvable in the normal way.
* The card and its button are **absent entirely** for the second person.
* Pressing restore on an entry that already has steps is refused (*"This entry
  already has approval steps"*), so a half-finished approval can never be wiped.
* With no active flow configured, it refuses with the same *"No approval flow
  configured"* message submitting gives.

### B2 — The real entry SE-20260814-001

**Confirmed by the automated pass on 18 Aug 2026:** the entry is `SUBMITTED`
with **0 pending approval steps**. Both halves of the reported symptom reproduce
on live data.

**Why the staffing fix did not help.** A Central Stock Manager was created at
Hyderabad, given `stock.approve`, and the approval flow was pointed at that
role. `approvalRefusal` now permits both Phani Raj and the new Hyderabad manager
to act on this entry — and they still saw nothing, because the steps are
snapshotted onto an entry **when it is submitted and never re-read**. Editing
the flow changes what the *next* submission copies; it cannot reach an entry
already in flight. That is what B1's restore path is for: with the fix in place,
both of them now see **Restore approval steps** on this entry, which recreates
step `1: Manager` and makes it approvable.

1. Log in as Super Admin and open the entry (BLDC MOTOR, 4 units, Hyderabad).

**Expected**

* Confirms B1's symptom on the actual record: status `SUBMITTED`, no card, no
  way forward.
* Decide the disposition: rebuild its approval row so it can be approved
  normally, or push it back to DRAFT so it can be edited and resubmitted. Tell
  me which and I will do it.

### B3 — Approving with a step order that does not exist

*Guards the server action, not just the screen.*

1. As Super Admin, on an entry that is `SUBMITTED` with a step 1, call
   `approveStockEntry(entryId, 99)` (from a script or the browser console
   against the server action).

**Expected** — `{ error: "Approval step not found" }` and nothing changes.

---

## C. Who may act — permission and scope rules

### C1 — No `stock.approve`, no card

1. Log in as **Spandana** (Stock Entry Operator) and open any `SUBMITTED` entry.

**Expected** — the entry is readable, but the Approve / Reject card is absent
entirely (not disabled, not greyed). Same for **Manohar** and **Nagarajan**.

### C2 — Approving an entry belonging to another department

1. As Super Admin, move some approved stock into **R&D**, or create an entry
   whose `departmentId` is R&D and submit it.
2. Log in as **Kirubakaran** (Production) and try to approve it.

**Expected** — refusal *"That entry belongs to another department"*. He should
not see it in his approval queue either.

*Worth being precise here:* Kirubakaran's stock scope is **location**, not
department — `stock.scope.location` comes with his Stock Approver and Builder
roles and outranks the Department Manager's `stock.scope.department`. So he
**does see** R&D's Bengaluru stock on `/stock`, and still **cannot approve** it:
seeing and approving are two different rules, and `approvalRefusal` only waives
the department check for scope `all`.

### C3 — Approving an entry from another site

Covered operationally by A4; the assertion is the exact message *"Those goods
arrived at another site, so someone there has to approve them"*.

### C4 — Scope `all` overrides both narrowings

1. As **Super Admin**, approve entries at both Bengaluru and Hyderabad, in a
   department and in central stock.

**Expected** — all succeed. `approvalRefusal` returns `null` first thing when
the scope is `all`.

### C5 — The dashboard queue never offers what would be refused

1. Log in as each of Super Admin, Kirubakaran, Spandana.

**Expected**

* Super Admin: every `SUBMITTED` entry, both sites.
* Kirubakaran: only Bengaluru entries that are his department's or central.
* Spandana: no approval queue at all (no `stock.approve` — the card does not
  render).
* Kirubakaran: note the deliberate difference from C2 — his `/stock` list is
  wider than his queue. Bengaluru central stock and Production entries appear in
  the queue; other Bengaluru departments' entries appear in the list only.

### C6 — Everyone else who can see this entry, and what they may do with it

Create one `SUBMITTED` central entry at **Bengaluru** as the Super Admin, then
open it as each person below without changing anything. This is one screen seen
through eight sets of permissions.

| Person | Sees the entry? | Approve / Reject card | Also expect |
| --- | --- | --- | --- |
| **Phani Raj** (Super Admin) | yes | **yes** | prices, warranty, batch, everything |
| **Kirubakaran** (Stock Approver, Bengaluru) | yes | **yes** | **no prices** — he approves goods whose value he never sees |
| **Nagarajan** (Auditor, scope all + value) | yes | no | prices and totals visible; no way to act on it |
| **Spandana** (operator, scope own) | **no** — not her entry | no | the stock list is empty of it; opening by URL must behave as "not found" |
| **Uday** (operator + dispatch, scope location) | yes — Bengaluru | no | prices visible (`stock.value.view`), no approval card |
| **Manohar** (R&D manager, scope department) | yes, while it is central and actionable | no | no prices; can request/move once approved |
| **Deepanjona / Raghava** (engineers) | yes, same reason | no | no prices, no warranty details |
| **Shravani** (Admin, no `stock.view`) | **no** | no | `/stock` and the entry URL both bounce to `/unauthorized` |
| **Ashish** (Hyderabad) | **no** — wrong site | no | he sees only Hyderabad stock |

**The check that matters:** an entry visible to nine people is actionable by
two, and priced for four. Nothing in between is greyed out — the controls are
simply not on the page.

### C7 — Not visible is reported as not existing

1. As **Ashish**, open the Bengaluru entry's URL directly (`/stock/<id>`).

**Expected** — a not-found page, never "you are not allowed to see this". The
detail action returns `null` for anything outside scope on purpose, so the URL
cannot be used to confirm that an entry exists at another site.

---

## D. Rejection and the way back

### D1 — Reject with a reason

1. As Super Admin (or Kirubakaran, for a Bengaluru entry), open a `SUBMITTED`
   entry, press **Reject**, type a reason, confirm.

**Expected** — status `REJECTED`, the reason is stored and shown to the creator,
the approval row is `REJECTED` with the rejecting user recorded.

### D2 — Reject with an empty reason

**Expected** — the Reject button in the dialog stays disabled; the action is
never called.

### D3 — Edit and resubmit a rejected entry

1. As the entry's creator, open the rejected entry, press **Edit**, change the
   quantity, save, then **Submit for Approval** again.

**Expected**

* Status returns to `DRAFT` on save, `rejectionReason` cleared.
* On resubmit, the **previous approval rows are deleted and a fresh set
  written** — exactly one `PENDING` row again, never a stale `REJECTED` one
  alongside it (`submitStockEntry` deletes before it creates).

### D4 — A second person cannot submit someone else's draft

1. As Super Admin, create a **draft** (Save Draft, do not submit).
2. Log in as Kirubakaran or Spandana and open it.

**Expected today** — `submitStockEntry` refuses with *"You can only submit your
own entries"*, and there is no Submit button for them. Worth deciding whether an
`all`-scope holder should be able to push a stranded draft forward; today nobody
can, and the draft sits there if its creator leaves.

---

## E. The approval flow configuration itself

### E1 — No active flow at all

1. In `/configure` (or stock configuration), deactivate the Default Approval
   Flow or remove its only step.
2. As Super Admin, try to submit a new entry.

**Expected** — *"No approval flow configured. Contact an administrator."* and
the entry stays `DRAFT`. Nothing half-submitted.

### E2 — Changing the flow does not strip entries already in flight

1. Submit an entry (one `PENDING` row exists).
2. Remove the flow's step and add a different one.
3. Reopen the in-flight entry.

**Expected** — the entry keeps its **snapshotted** step and is still approvable.
The snapshot is by design: `stock_approvals` stores `stepLabel` and
`approverRoleId` as values, not as foreign keys to the flow.

### E3 — Two-step flow

1. Add a second step to the flow (e.g. order 2, another approver role).
2. Submit a fresh entry, approve step 1.

**Expected** — the entry stays `SUBMITTED`, the card now shows step 2 as
pending, and only after step 2 is approved does the status become `APPROVED`.

### E4 — Department-specific flow beats the default

1. Create a flow bound to **Production** with its own step.
2. Submit an entry whose department is Production.

**Expected** — the Production flow's steps are snapshotted, not the default's.
*Note while testing:* the lookup orders by `departmentId: "desc"` and the
comment claims "null sorts last", but PostgreSQL puts NULLs **first** on `DESC`.
If this test fails and the default flow wins, that comment is the reason —
tell me and I will propose a fix.

---

## F. Integrity checks to run after any of the above

Run these to catch silent breakage rather than visible breakage.

1. **No SUBMITTED entry without a pending step**

   ```sql
   SELECT e."entryNumber"
   FROM stock_entries e
   LEFT JOIN stock_approvals a
     ON a."stockEntryId" = e.id AND a.status = 'PENDING'
   WHERE e.status = 'SUBMITTED' AND a.id IS NULL;
   ```

   Expected: zero rows. Today it returns **SE-20260814-001** — that is the bug.

2. **No APPROVED entry without an approver**

   ```sql
   SELECT "entryNumber" FROM stock_entries
   WHERE status = 'APPROVED' AND "approvedById" IS NULL;
   ```

   Expected: only entries created already-approved by the build and dispatch
   flows (`src/lib/actions/builds.ts:348`, `src/lib/actions/dispatch.ts:534`),
   which never pass through approval. Anything else means an approval was
   completed without the final update.

3. **Every status change has an activity log** — for each entry you touched,
   check there is a matching `SUBMITTED` / `APPROVED` / `REJECTED` line. A
   status that moved with no log means it did not move through the app.

---

## G. The other stock permissions that ride along with this flow

Approving is one key; a stock entry passes through six more on its way. Each of
these is also in the breadth file, but they are easiest to test here because one
entry exercises them all.

### G1 — `stock.batch.edit`, at the only place a batch is typed

1. As **Spandana**, open `/stock/new`: the batch number field is present.
2. As the **Super Admin**, temporarily grant **Kirubakaran** `stock.create` and
   open the same page.

**Expected** — no batch field for him, and a batch posted directly to
`createStockEntry` is **ignored, not rejected** (`effectiveBatch` is only read
from someone who holds the key). Confirm the saved entry has no batch.

### G2 — `stock.warranty.edit` / `stock.warranty.view`

1. As **Spandana**, record warranty details on a draft, then submit it.
2. Open the same entry as **Kirubakaran** (view only) and as **Deepanjona**.

**Expected** — Spandana can edit; Kirubakaran sees the warranty card but cannot
change it; Deepanjona has no warranty card at all.

### G3 — `stock.value.view` through the whole flow

1. Follow one entry from draft to approved as **Kirubakaran**.

**Expected** — no price on the list, the detail page, the approval card, the
dashboard tiles or any export. Then repeat as **Nagarajan** and confirm every
one of those places shows the value. This is the money switch working
independently of everything else.

### G4 — Required documents block submission

1. As Super Admin, mark an attachment type **required** in `/configure`.
2. As **Spandana**, create a draft without it and press Submit.

**Expected** — *"Required documents missing: …"*, the entry stays `DRAFT`, and no
approval rows are written. Upload the document and submit again to confirm it
clears.

### G5 — `stock.edit` and who may edit what

1. As **Uday**, try to edit a draft **Spandana** created.
2. As the **Super Admin**, edit the same draft.

**Expected** — Uday is refused (*"You can only edit your own entries"*) despite
holding `stock.edit`, because editing someone else's needs scope `all`. The
Super Admin succeeds.

### G6 — `stock.move` only after approval

1. As **Manohar**, open an entry that is still `SUBMITTED`, then the same entry
   once approved.

**Expected** — no Move control while it is pending; it appears only on an
`APPROVED` entry with quantity left. **Deepanjona**, who lacks `stock.move`, is
offered a transfer *request* instead, which lands in her manager's queue.

### G7 — Deleting an attachment

1. As **Spandana**, delete a document from her own draft — allowed.
2. Submit the entry, then try again.

**Expected** — refused once the entry is no longer DRAFT/REJECTED, and refused
outright for someone else's attachment unless the caller has scope `all`.

---

## Result sheet

| ID | Scenario | Expected | Result | Notes |
| --- | --- | --- | --- | --- |
| A1 | Super Admin submit snapshots the step | Card + 1 PENDING row | | |
| A2 | Super Admin approves own entry | Succeeds, no self-approval block | | |
| A3 | Stock Approver approves Super Admin's entry | Succeeds | | |
| A4 | Hyderabad entry, no local approver | Only Super Admin can approve | | |
| B1 | SUBMITTED with no step | Dead end reproduced | | |
| B2 | SE-20260814-001 | Dead end confirmed on real data | | |
| B3 | Unknown step order | "Approval step not found" | | |
| C1 | No `stock.approve` | No card rendered at all | | |
| C2 | Another department | "belongs to another department" | | |
| C3 | Another site | "arrived at another site" | | |
| C6 | One entry, nine viewers | 2 can act, 4 see prices | | |
| C7 | Out-of-scope URL | Not found, never "forbidden" | | |
| C4 | Scope `all` | Approves anywhere | | |
| C5 | Dashboard queue matches the rules | No unusable rows offered | | |
| D1 | Reject with reason | REJECTED + reason stored | | |
| D2 | Reject with no reason | Button stays disabled | | |
| D3 | Edit and resubmit | Fresh single PENDING row | | |
| D4 | Submit someone else's draft | Refused today | | |
| E1 | No active flow | Clear error, stays DRAFT | | |
| E2 | Flow changed mid-flight | Snapshot survives | | |
| E3 | Two-step flow | Approves only after both steps | | |
| E4 | Department flow beats default | Department steps used | | |
| G1 | Batch field, and the silent ignore | Field absent; batch dropped | | |
| G2 | Warranty view vs edit | Three different screens | | |
| G3 | Value hidden end to end | No price anywhere for Kirubakaran | | |
| G4 | Required document blocks submit | Stays DRAFT, no approval rows | | |
| G5 | Editing someone else's draft | Refused without scope `all` | | |
| G6 | Move only after approval | Request offered instead | | |
| G7 | Attachment deletion rules | Refused after submission | | |
| F1 | SUBMITTED without pending step | Zero rows | | |
| F2 | APPROVED without approver | Only build/dispatch entries | | |
| F3 | Status changes are logged | One log per change | | |

---

## H. Cross-site stock — reported 18 Aug 2026

### H1 — A site is never offered its own stock to ask for

1. As **Ashish** (Hyderabad), open Fulfilment and check 2 × Personal Computer,
   of which Hyderabad holds 1.

**Expected** — the Hyderabad row of *Where it is* reads **"Your site"** with no
Ask button; only other sites can be asked. The summary counts the 1 that is
already here and says only the remainder has to come from somewhere else.

**Was** — Hyderabad offered an *Ask for stock* button to a Hyderabad user, i.e.
asking itself to send what was already standing there.

### H2 — Someone with no site keeps every option

1. As the **Super Admin** (no department, so no site), check the same product.

**Expected** — every site keeps its Ask button, because an admin is asking on
behalf of a site rather than for themselves, and picks both ends in the dialog.

### H3 — The dispatch picker says why it is empty

1. As the **Super Admin**, open New Dispatch and do not choose an origin.
2. Choose a site with no central stock.
3. Choose a site with stock, and add everything to the consignment.

**Expected** — three different messages: *choose which site this is leaving
from*, *there is no uncommitted central stock at X*, and *everything available
here is already on the consignment*. Previously all three said the last one,
which reads as stock going missing.

### H4 — Only the origin's stock is ever offered

1. As someone who holds `stock.scope.all` **and** belongs to a site, open New
   Dispatch.

**Expected** — only that site's stock is listed. Previously every site's stock
was offered and `createDispatch` refused it on submit with *"is not held at your
location"* — a control that errored on click.

### H5 — Received stock is immediately dispatchable

1. Confirm delivery of a consignment at Hyderabad.
2. Open New Dispatch at Hyderabad.

**Expected** — the received item is in the picker straight away, available to
send on to a client or another site. Verified in the data on 18 Aug 2026:
SE-20260818-001 (Personal Computer) shows as available = 1 for both the
Hyderabad operator and the Super Admin with Hyderabad as origin.

---

## I. Stock is counted once, not at both ends

Reported 18 Aug 2026: a PC built in Bengaluru, dispatched to Hyderabad and sent
back, showed as 1 in Hyderabad **and** 2 in Bengaluru — three PCs on screen for
one physical machine.

The ledger was always right; four screens were reading the wrong field. An entry
keeps the quantity that ARRIVED for ever, and what has left it is recorded
separately in issues, dispatch lines, build consumptions and pending requests.
`src/lib/stock-availability.ts` now names the two questions apart:

* `heldQuantity()` — what is physically standing here: arrived, less issued,
  dispatched and consumed. A pending request is **not** subtracted; nothing has
  moved, somebody has only asked.
* `availableQuantity()` — what can still be promised: `heldQuantity` less
  pending requests. Never larger than the first.

| ID | Scenario | Expected |
| --- | --- | --- |
| I1 | Build 1 PC at Bengaluru, dispatch it to Hyderabad, confirm delivery | Bengaluru's entry reads **0 here now, of 1 received**; Hyderabad's new entry reads 1. Company total: 1. |
| I2 | Send the same PC back to Bengaluru | Hyderabad drops to 0, Bengaluru's new entry holds 1. The original Bengaluru entry stays at 0 — it is history, not stock. Total is still 1, never 2. |
| I3 | Reports → central stock and department holdings | Every quantity and value matches the list. Dispatched, built-with and issued stock is gone from all of them. |
| I4 | Entry page for a fully dispatched entry | *Remaining in Stock* reads 0, and no Move or Request control is offered. |
| I5 | Raise a transfer request but do not approve it | *Here now* is unchanged — the goods have not moved. The dispatch picker and fulfilment plan drop by the requested amount, because it is spoken for. |
| I6 | Value columns | Value follows what is here, not what the consignment cost. The entry itself still shows what was paid. |

**On the data as it stood when this shipped:** 10 of the approved entries were
over-counted, overstating held stock by ₹4,14,700 — mostly BLDC motors and panel
boards consumed by builds, which the list had gone on counting as if they were
still on the shelf.
