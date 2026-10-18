import { buildCreateProfileHref, type SignupSource } from "./signup-source";

export type GrowthPromptCopy = {
  /** Used instead of href when the next step works without a KaspaLinks account. */
  accountFreeHref?: string;
  body: string;
  cta: string;
  href: string;
};

// Constant hrefs: prompts never read the current URL, so the claim page's secret
// fragment cannot end up in a link.
export const GROWTH_PROMPTS: Record<SignupSource, GrowthPromptCopy> = {
  "claim-success": {
    accountFreeHref: "/claim/create/single?utm_source=claim-success",
    body: "Fund a claim link from your wallet and send it privately. No account, no custody.",
    cta: "Send KAS to a friend the same way",
    href: buildCreateProfileHref({ next: "/claim/create", signupSource: "claim-success" }),
  },
  "giveaway-entry": {
    body: "Send KAS to your community with claim links. No account, no custody.",
    cta: "Create your own",
    // The chooser itself offers the account-free path when it is switched on.
    href: "/claim/create?utm_source=giveaway-entry",
  },
  // Labels links made from the bot (/claim); the bot itself shows no prompt.
  "telegram-bot": {
    body: "Create claim links and payment links right from Telegram.",
    cta: "Create a claim link",
    href: "/claim/create?utm_source=telegram-bot",
  },
  "pay-success": {
    accountFreeHref: "/new-link?utm_source=pay-success",
    body: "Create your own page in seconds. No email, no custody.",
    cta: "Get paid in KAS yourself",
    href: buildCreateProfileHref({ next: "/new-link", signupSource: "pay-success" }),
  },
};

export const PAY_SHARE_UTM_SOURCE = "pay-share";

const SHAREABLE_PATH = /^\/(?:a|u)\//;

/**
 * The public payment page a payer may share. Drops any query or fragment and only
 * accepts payment link and profile paths, so nothing private travels with it.
 */
export function buildPayShareUrl(input: { origin: string; pathname: string }): null | string {
  const pathname = input.pathname.split(/[?#]/, 1)[0] ?? "";
  if (!SHAREABLE_PATH.test(pathname) || pathname.startsWith("//")) return null;

  try {
    const url = new URL(pathname, input.origin);
    url.searchParams.set("utm_source", PAY_SHARE_UTM_SOURCE);
    return url.toString();
  } catch {
    return null;
  }
}
