export const MIN_RELIABLE_MAINNET_OUTPUT_KAS = "0.2";
export const MIN_RELIABLE_MAINNET_OUTPUT_SOMPI = 20_000_000n;

export function getMainnetOutputMinimumMessage(label = "KAS amount"): string {
  return `${label} must be at least ${MIN_RELIABLE_MAINNET_OUTPUT_KAS} KAS for reliable mainnet wallet payments. Kaspa wallets may reject smaller outputs because of storage-mass rules.`;
}

export function isBelowReliableMainnetOutputMinimum(amountSompi: bigint): boolean {
  return amountSompi < MIN_RELIABLE_MAINNET_OUTPUT_SOMPI;
}

export function assertReliableMainnetOutputAmount(amountSompi: bigint, label?: string): void {
  if (isBelowReliableMainnetOutputMinimum(amountSompi)) {
    throw new Error(getMainnetOutputMinimumMessage(label));
  }
}
