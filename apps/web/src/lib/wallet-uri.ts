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
