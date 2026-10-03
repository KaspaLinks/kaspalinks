import { buildCreateProfileHref, type SignupSource } from "./signup-source";

export type GrowthPromptCopy = {
  body: string;
  cta: string;
  href: string;
};

// Constant hrefs: prompts never read the current URL, so the claim page's secret
// fragment cannot end up in a link.
export const GROWTH_PROMPTS: Record<SignupSource, GrowthPromptCopy> = {
  "claim-success": {
    body: "Fund a claim link from your wallet and share it. No custody.",
    cta: "Send KAS to a friend the same way",
    href: buildCreateProfileHref({ next: "/claim/create", signupSource: "claim-success" }),
  },
  "pay-success": {
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
