/**
 * The rule that whoever raised something is never the one who answers it.
 *
 * Used by: dispatch (accepting and rejecting a consignment) and fulfilment
 * (agreeing to or declining another site's request).
 *
 * A site with one pair of hands would otherwise have that person accepting
 * their own consignments, which turns a real check into a formality nobody can
 * see is missing. Bills of materials already worked this way; this is the same
 * rule stated once for the places that had not caught up.
 *
 * Confirming DELIVERY is deliberately outside this — receiving goods you asked
 * for is the normal case, not a self-approval.
 */
export const SELF_APPROVAL_REFUSAL =
  "You raised this, so it is not yours to answer. Someone else has to review it.";
