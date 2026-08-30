export type GiveawayDisplayInput = {
  prize: null | {
    claimTxId?: null | string;
    funded: boolean;
    status: string;
  };
  status: "CANCELLED" | "CLOSED" | "DRAWN" | "NO_ENTRIES" | "OPEN" | "PENDING_FUNDING";
  winnerClaim?: {
    expiresAt: null | string;
    preparedTransactionId: null | string;
  };
};

export type GiveawayDisplayState = {
  detail: null | string;
  label: string;
  toneClass: "status-confirmed" | "status-failed" | "status-pending" | "status-profile-hidden";
};

export function giveawayDisplayState(
  giveaway: GiveawayDisplayInput,
  nowMs = Date.now(),
): GiveawayDisplayState {
  if (giveaway.prize?.status === "claimed") {
    return {
      detail: "The winner has claimed the prize on-chain.",
      label: "Claimed by winner",
      toneClass: "status-confirmed",
    };
  }

  if (giveaway.prize?.status === "refunded") {
    return {
      detail: "The unclaimed prize was refunded to the creator.",
      label: "Refunded to creator",
      toneClass: "status-profile-hidden",
    };
  }

  if (giveaway.prize?.status === "spent_unknown") {
    return {
      detail: "The prize output was spent, but the destination could not be classified.",
      label: "Spent on-chain",
      toneClass: "status-failed",
    };
  }

  if (giveaway.status === "DRAWN") {
    const claimExpired = Boolean(
      giveaway.winnerClaim?.expiresAt &&
      new Date(giveaway.winnerClaim.expiresAt).getTime() <= nowMs,
    );
    if (claimExpired && giveaway.prize?.funded) {
      return {
        detail: "The winner did not claim in time. The prize is ready to refund.",
        label: "Refund available",
        toneClass: "status-pending",
      };
    }

    if (giveaway.winnerClaim?.preparedTransactionId && giveaway.prize?.funded) {
      return {
        detail: "The winner can open the giveaway page and claim the prize now.",
        label: "Winner can claim",
        toneClass: "status-pending",
      };
    }

    return {
      detail: giveaway.prize
        ? "The winner is selected. The winner claim still needs to be prepared."
        : "The winner is selected. This giveaway does not track the payout on-chain.",
      label: "Winner selected",
      toneClass: "status-pending",
    };
  }

  switch (giveaway.status) {
    case "PENDING_FUNDING":
      return { detail: null, label: "Waiting for funding", toneClass: "status-pending" };
    case "OPEN":
      return { detail: null, label: "Open", toneClass: "status-confirmed" };
    case "CLOSED":
      return { detail: null, label: "Awaiting draw", toneClass: "status-pending" };
    case "NO_ENTRIES":
      return { detail: null, label: "No entries", toneClass: "status-failed" };
    case "CANCELLED":
      return { detail: null, label: "Cancelled", toneClass: "status-failed" };
  }
}
