# Decisions, and why

The questions this system had to settle, and what was settled. Nothing here is
outstanding — it is kept because these are the choices you will want to remember
when you read the code back and it surprises you.

For what the system *does*, read `README.md`. For where things live, `summary.md`.
For who holds what today, `permissions.md`.

> Condensed from `docs/access-and-flow-plan.html`, the 83 KB working document
> these were decided in. That rebuild has shipped, so the plan was removed and
> this is the part of it that still earns its place. It is in git history if you
> ever need the full reasoning: `git log --diff-filter=D -- docs/`.

---

## Roles and people

| Question | Decision |
|---|---|
| **The two engineer roles** | One `Engineer` role replaces both of the empty ones. |
| **Two jobs, one person** | Roles became **additive**. Somebody's permissions are the union of every role they hold, so Uday holds two and Kirubakaran holds three rather than anyone inventing a role per combination. Nobody needs an individual grant. |
| **Nagarajan and needs** | He verifies purchase needs exactly as Kirubakaran does — one `Buyer` role serves both, held on top of their primary role. |
| **Shravani and assets** | Read only. She sees what each department holds; creating an asset stays with the people who can see the stock it comes from. |
| **The four odd accounts** | Admin → Shravani. Dispatch Hyderabad → Ashish. Dispatch Bengaluru deactivated. Spandana kept. |

Retired roles — `Central Stock Manager`, `Staff`, `Production Engineer`,
`R&D Engineer` — are **kept, not deleted**: their names appear on historic
approval records, and deleting them would blank those out.

## Visibility

| Question | Decision |
|---|---|
| **Cross-site visibility** | Availability *counts* per site are visible to anyone with `fulfilment.view` — you cannot ask another site for stock you cannot see. Entry *detail*, with its vendors, prices and invoices, stays behind the stock scopes. |
| **Uday's stock scope** | Deliberately widened. He sees every Bengaluru entry, which is what lets him dispatch stock he did not book in himself. Every other stock entry operator stays own-entries-only. |

## Rules that apply to everyone

| Question | Decision |
|---|---|
| **Hyderabad's one pair of hands** | **Nobody answers their own request.** A hard rule for everyone, not a staffing workaround — it would have been easy to make an exception for a site with one person, and the exception is exactly what an audit trail cannot survive. Lives in `src/lib/review-rules.ts`. |
| **Bills of materials by department** | A submission records its author's department, and approval routes to *that* department's manager. |

## Shape of the app

The `requests.*` namespace disappeared: a request now lives with the thing it is
about, rather than in a queue of its own.

| Was | Became |
|---|---|
| Requests → Transfers tab | `/assets`, beside Holdings — raising and approving in one place |
| Requests → Products tab | `/stock/products`, beside the catalog |
| Requests → Categories tab | the same tab, split by type |
| `requests.transfer.create` / `.approve` | `assets.transfer.request` / `assets.transfer.approve` |
| `requests.product.create` / `.approve` | `products.request.create` / `products.request.approve` |

The principle: **a permission key is named after the thing it acts on**, so the
Assets page's keys all start `assets.`, and nobody has to remember that transfers
were once their own module.

## Live updates, and the thing deliberately not built

Pages refresh themselves two ways: immediately when somebody comes back to the
tab, and on a slow poll while it is open (`src/hooks/use-live-data.ts`).

**Server-Sent Events were considered and declined**, not deferred. A refresh is a
full server re-render, so the cheap version was measured first: focus covers the
case people actually notice, and the poll covers a wall display nobody is sitting
at. SSE would add a connection per open tab, and a reason to keep it alive, for a
team this size. The decision was to wait until refresh-on-focus plus a poll is
demonstrably not enough — and it has not been.

> Condensed from `docs/plan-next-phase.md`, whose four phases have all landed.
> Removed for the same reason; also in git history.

## Still open

**The database during a history squash.** The safe path is the default — history
squashed, every row kept. A clean database is available instead if that is ever
wanted.
