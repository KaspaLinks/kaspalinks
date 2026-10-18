// Shared by the Telegram bot and the Mini App. Telegram-only workspaces have no
// public profile (/u/<name> shows registered creators only), so their payment
// links are always shared as /a/<publicId>.

export function isTelegramOnlyAccount(creator: { accountKind?: string }): boolean {
  return creator.accountKind === "TELEGRAM_ONLY";
}

export function telegramActionPath(
  creator: { accountKind?: string; username: string },
  action: { publicId: string; slug: null | string },
): string {
  return action.slug && !isTelegramOnlyAccount(creator)
    ? `/u/${creator.username}/${action.slug}`
    : `/a/${action.publicId}`;
}

export const TELEGRAM_PAYMENT_LINK_TYPES = [
  "kaspa.tip",
  "kaspa.donation",
  "kaspa.goal",
  "kaspa.invoice",
  "kaspa.transfer",
] as const;

export type TelegramPaymentLinkType = (typeof TELEGRAM_PAYMENT_LINK_TYPES)[number];
