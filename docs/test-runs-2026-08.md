# Test runs — August 2026

What the permission and stock-approval test passes found, and what was done
about it. This is **history**: the checklists themselves live in
`test-cases-permissions.md` and `test-cases-stock-approval.md`, and were split
from these notes so that a checklist reads as a checklist rather than as a
checklist mixed with the story of one afternoon.

Kept because every defect below is a shape of bug this system can produce again,
and the fix is easier to trust when you can see what it was a fix for.

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
