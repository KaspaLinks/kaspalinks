export type EscrowLinkStage =
  | "accept"
  | "fund"
  | "funding_expired"
  | "funding_review"
  | "resolve"
  | "submitted";

export function escrowLinkStage(escrow: {
  buyerPublicKey: string | null;
  chainDaa: string | null;
  funding: { state: "ambiguous" | "awaiting_funding" | "funded" | "not_ready" };
  releaseAfter: string | null;
  submitted: unknown | null;
}): EscrowLinkStage {
  if (escrow.submitted) return "submitted";
  if (!escrow.buyerPublicKey) return "accept";
  if (escrow.funding.state === "ambiguous") return "funding_review";
  if (escrow.funding.state === "funded") return "resolve";
  if (
    escrow.releaseAfter !== null &&
    escrow.chainDaa !== null &&
    BigInt(escrow.chainDaa) >= BigInt(escrow.releaseAfter)
  ) {
    return "funding_expired";
  }
  return "fund";
}
