export function buildWalletLaunchUri(input: {
  amountKas: null | string;
  recipientAddress: string;
}): string {
  const amountKas = input.amountKas?.trim();

  if (!amountKas) {
    return input.recipientAddress;
  }

  return `${input.recipientAddress}?amount=${encodeURIComponent(amountKas)}`;
}

const WALLET_LAUNCH_URI = /^(kaspa:[a-z0-9]{40,90})(?:\?(.*))?$/;
const WALLET_LAUNCH_PARAMS = new Set(["amount", "label", "message"]);

/**
 * Accepts only a kaspa: payment URI with an amount and optional label and message
 * (giveaway funding carries both). The URI handed on is rebuilt from the address
 * and amount alone, so nothing else can become a link target.
 */
export function parseWalletLaunchUri(
  uri: string,
): null | { address: string; amountKas: null | string; uri: string } {
  const match = WALLET_LAUNCH_URI.exec(uri);
  if (!match?.[1]) return null;
  const params = new URLSearchParams(match[2] ?? "");
  for (const key of params.keys()) {
    if (!WALLET_LAUNCH_PARAMS.has(key) || params.getAll(key).length > 1) return null;
  }
  const amountKas = params.get("amount");
  if (amountKas !== null && !/^\d+(?:\.\d+)?$/.test(amountKas)) return null;
  return {
    address: match[1],
    amountKas,
    uri: amountKas === null ? match[1] : `${match[1]}?amount=${amountKas}`,
  };
}

// Telegram's Mini App view cannot hand a kaspa: link to a wallet app. This page
// opens in the phone's browser instead, which can. The query differs on every tap,
// so a browser tab still open from an earlier tap loads the page again.
export function walletBridgePath(uri: string, openedAt: number = Date.now()): string {
  return `/open-wallet?at=${openedAt}#${encodeURIComponent(uri)}`;
}
