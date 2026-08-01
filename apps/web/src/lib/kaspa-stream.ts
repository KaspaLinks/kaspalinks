export function kaspaStreamTransactionUrl(transactionId: string): string | undefined {
  if (!/^[0-9a-f]{64}$/i.test(transactionId)) return undefined;

  return `https://kaspa.stream/transactions/${transactionId.toLowerCase()}`;
}
