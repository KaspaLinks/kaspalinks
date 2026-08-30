export function buildCreatorProfilePath(username: string): string {
  return `/u/${encodeURIComponent(username.trim())}`;
}

export function buildXBioText(profileUrl: string): string {
  return `Support me with KAS: ${profileUrl} | No extension. Wallet-to-wallet.`;
}

export function buildXPostText(input: {
  includeUrl?: boolean;
  shareUrl?: string;
  title?: null | string;
}): string {
  const title = input.title?.trim();
  const intro = title
    ? `I just created a non-custodial Kaspa link for "${title}".`
    : "I just created a non-custodial Kaspa link.";

  const lines = [intro, "", "No extension. No custody. Wallet-to-wallet."];

  if (input.includeUrl !== false && input.shareUrl) {
    lines.push("", "Support me here:", input.shareUrl);
  }

  return lines.join("\n");
}

export function buildProfileXPostText(input: {
  includeUrl?: boolean;
  profileUrl?: string;
}): string {
  const lines = [
    "My Kaspa Links profile is live.",
    "",
    "Support me directly with KAS.",
    "No extension. No custody. Wallet-to-wallet.",
  ];

  if (input.includeUrl !== false && input.profileUrl) {
    lines.push("", "Profile:", input.profileUrl);
  }

  return lines.join("\n");
}

export function buildGiveawayXPostText(input: {
  amountKas: string;
  title: string;
}): string {
  return `${input.title.trim()} — enter for a chance to win ${input.amountKas} $KAS.`;
}

export function buildGiveawayWinnerXPostText(input: {
  amountKas: string;
  includeUrl?: boolean;
  shareUrl?: string;
  title: string;
  winnerAddress: string;
}): string {
  const winnerAddress = input.winnerAddress.trim();
  const winner =
    winnerAddress.length <= 28
      ? winnerAddress
      : `${winnerAddress.slice(0, 14)}…${winnerAddress.slice(-10)}`;
  const title = input.title.trim();
  const displayTitle = title.length > 50 ? `${title.slice(0, 49)}…` : title;
  const lines = [
    "🎉 We have a winner!",
    "",
    `${winner} won ${input.amountKas} $KAS in "${displayTitle}".`,
    "",
    "View and verify the result:",
  ];

  if (input.includeUrl !== false && input.shareUrl) {
    lines.push(input.shareUrl);
  }

  return lines.join("\n");
}

type XIntentInput =
  | string
  | {
      hashtags?: string[];
      text: string;
      url?: string;
    };

function normalizeHashtags(hashtags: string[] | undefined): string {
  return (hashtags ?? [])
    .map((hashtag) => hashtag.trim().replace(/^#/, ""))
    .filter((hashtag) => /^[A-Za-z0-9_]+$/.test(hashtag))
    .join(",");
}

export function buildXIntentUrl(input: XIntentInput): string {
  const options = typeof input === "string" ? { text: input } : input;
  const url = new URL("https://x.com/intent/tweet");
  url.searchParams.set("text", options.text);
  if (options.url) {
    url.searchParams.set("url", options.url);
  }

  const hashtags = normalizeHashtags(options.hashtags);
  if (hashtags) {
    url.searchParams.set("hashtags", hashtags);
  }

  return url.toString();
}
