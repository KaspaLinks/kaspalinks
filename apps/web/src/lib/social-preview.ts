export type SocialPreview = {
  description: string;
  title: string;
};

export type GiveawayPreviewStatus =
  | "CANCELLED"
  | "CLOSED"
  | "DRAWN"
  | "NO_ENTRIES"
  | "OPEN"
  | "PENDING_FUNDING";

const MAX_DESCRIPTION_LENGTH = 180;

export function collapseWhitespace(value: null | string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function truncatePreviewText(value: string, maxLength = MAX_DESCRIPTION_LENGTH): string {
  const text = collapseWhitespace(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export function actionTypeLabel(type: string): string {
  switch (type) {
    case "KASPA_DONATION":
    case "kaspa.donation":
      return "Donation";
    case "KASPA_GOAL":
    case "kaspa.goal":
      return "Goal";
    case "KASPA_INVOICE":
    case "kaspa.invoice":
      return "Invoice";
    case "KASPA_TIP":
    case "kaspa.tip":
      return "Tip";
    case "KASPA_TRANSFER":
    case "kaspa.transfer":
      return "Transfer";
    default:
      return type.replace(/^kaspa\./, "");
  }
}

export function buildProfileSocialPreview(input: {
  bio?: null | string;
  displayName?: null | string;
  username: string;
}): SocialPreview {
  const displayName = collapseWhitespace(input.displayName) || input.username;
  const bio = collapseWhitespace(input.bio);
  const fallback = `Support ${displayName} with direct Kaspa payments. Non-custodial, wallet-to-wallet.`;

  return {
    description: truncatePreviewText(bio ? `${bio} ${fallback}` : fallback),
    title: `${displayName} on Kaspa Links`,
  };
}

export function buildActionSocialPreview(input: {
  amountKas?: null | string;
  creatorDisplayName?: null | string;
  creatorUsername?: null | string;
  description?: null | string;
  goalKas?: null | string;
  title: string;
  type: string;
}): SocialPreview {
  const creatorName =
    collapseWhitespace(input.creatorDisplayName) ||
    collapseWhitespace(input.creatorUsername) ||
    "this creator";
  const title = collapseWhitespace(input.title) || "Kaspa payment link";
  const amountLabel = input.goalKas
    ? `${input.goalKas} KAS goal`
    : input.amountKas
      ? `${input.amountKas} KAS`
      : "Any amount";
  const typeLabel = actionTypeLabel(input.type);
  const description = collapseWhitespace(input.description);
  const fallback = `${typeLabel} · ${amountLabel}. Pay ${creatorName} directly with Kaspa. Non-custodial, wallet-to-wallet.`;

  return {
    description: truncatePreviewText(description ? `${description} ${fallback}` : fallback),
    title: `${title} · ${creatorName}`,
  };
}

export function buildGiveawaySocialPreview(input: {
  amountKas: string;
  closesAt: Date | string;
  description?: null | string;
  prizeFunded: boolean;
  status: GiveawayPreviewStatus;
  title: string;
}): SocialPreview & { amountLabel: string; typeLabel: string } {
  const title = collapseWhitespace(input.title) || "Kaspa giveaway";
  const description = collapseWhitespace(input.description);
  const closesAt = new Date(input.closesAt).getTime();
  const status =
    input.status === "OPEN" && Number.isFinite(closesAt) && closesAt <= Date.now()
      ? "CLOSED"
      : input.status;

  const state = giveawayPreviewState(status, input.prizeFunded, input.amountKas);
  const fallback = `${state.description} Non-custodial and wallet-to-wallet.`;

  return {
    amountLabel: `${input.amountKas} KAS prize`,
    description: truncatePreviewText(description ? `${description} ${fallback}` : fallback),
    title: `${title} · ${state.title}`,
    typeLabel: state.typeLabel,
  };
}

function giveawayPreviewState(
  status: GiveawayPreviewStatus,
  prizeFunded: boolean,
  amountKas: string,
): { description: string; title: string; typeLabel: string } {
  if (status === "PENDING_FUNDING" || !prizeFunded) {
    return {
      description: `A ${amountKas} KAS giveaway is being prepared. Entries open after the prize is verified on-chain.`,
      title: `${amountKas} KAS giveaway`,
      typeLabel: "Preparing",
    };
  }
  if (status === "OPEN") {
    return {
      description: `The ${amountKas} KAS prize is verified on-chain. The winner is selected with a verifiable Kaspa draw.`,
      title: `Win ${amountKas} KAS`,
      typeLabel: "Enter giveaway",
    };
  }
  if (status === "DRAWN") {
    return {
      description: `The winner of this ${amountKas} KAS giveaway has been selected with an auditable draw.`,
      title: "Winner drawn",
      typeLabel: "Winner selected",
    };
  }
  if (status === "NO_ENTRIES") {
    return {
      description: `This ${amountKas} KAS giveaway ended without eligible entries.`,
      title: "Giveaway ended",
      typeLabel: "No entries",
    };
  }
  if (status === "CANCELLED") {
    return {
      description: `This ${amountKas} KAS giveaway was cancelled.`,
      title: "Giveaway cancelled",
      typeLabel: "Cancelled",
    };
  }
  return {
    description: `Entries for this ${amountKas} KAS giveaway are closed while the draw is completed.`,
    title: "Entries closed",
    typeLabel: "Draw pending",
  };
}
