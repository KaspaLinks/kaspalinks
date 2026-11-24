import { validateRecipientAddress } from "./helpers";

/**
 * Values another surface (an AI assistant through the MCP server) may hand to
 * the new-link form. They travel after the `#`, which browsers never send to
 * the server, so the address does not end up in access logs. The visitor still
 * reviews the form and creates the link; nothing here creates anything.
 */
export type LinkPrefill = {
  amountKas?: string;
  recipientAddress?: string;
  title?: string;
};

export const LINK_PREFILL_TITLE_MAX = 80;
const AMOUNT_RE = /^(?:0|[1-9]\d{0,10})(?:\.\d{1,8})?$/;

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, LINK_PREFILL_TITLE_MAX).trim();
}

export function isPrefillAmount(value: string): boolean {
  return AMOUNT_RE.test(value) && Number(value) > 0;
}

/** Reads `#to=…&amount=…&title=…`. Invalid values are dropped one by one. */
export function parseLinkPrefill(hash: string): LinkPrefill {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const prefill: LinkPrefill = {};

  const to = params.get("to")?.trim() ?? "";
  if (to && validateRecipientAddress(to).state === "valid") prefill.recipientAddress = to;

  const amount = params.get("amount")?.trim() ?? "";
  if (isPrefillAmount(amount)) prefill.amountKas = amount;

  const title = normalizeTitle(params.get("title") ?? "");
  if (title) prefill.title = title;

  return prefill;
}

/** Builds the fragment that `parseLinkPrefill` reads, or "" when there is nothing to hand over. */
export function buildLinkPrefillHash(prefill: LinkPrefill): string {
  const params = new URLSearchParams();
  if (prefill.recipientAddress) params.set("to", prefill.recipientAddress);
  if (prefill.amountKas) params.set("amount", prefill.amountKas);
  const title = prefill.title ? normalizeTitle(prefill.title) : "";
  if (title) params.set("title", title);
  const encoded = params.toString();
  return encoded ? `#${encoded}` : "";
}
