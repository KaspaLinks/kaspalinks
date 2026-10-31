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

const WALLET_LAUNCH_URI = /^(kaspa:[a-z0-9]{40,90})(?:\?amount=(\d+(?:\.\d+)?))?$/;

/** Accepts only a plain kaspa: payment URI, so nothing else can become a link target. */
export function parseWalletLaunchUri(
  uri: string,
): null | { address: string; amountKas: null | string; uri: string } {
  const match = WALLET_LAUNCH_URI.exec(uri);
  if (!match?.[1]) return null;
  return { address: match[1], amountKas: match[2] ?? null, uri };
}

// Telegram's Mini App view cannot hand a kaspa: link to a wallet app. This page
// opens in the phone's browser instead, which can.
export function walletBridgePath(uri: string): string {
  return `/open-wallet#${encodeURIComponent(uri)}`;
}
