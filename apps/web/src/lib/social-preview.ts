export type SocialPreview = {
  description: string;
  title: string;
};

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
