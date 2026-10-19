// kaspa.stream is the one explorer Kaspa Links links to (transactions, blocks,
// addresses), so a creator never has to compare two explorers.

export function kaspaStreamTransactionUrl(transactionId: string): string | undefined {
  if (!/^[0-9a-f]{64}$/i.test(transactionId)) return undefined;

  return `https://kaspa.stream/transactions/${transactionId.toLowerCase()}`;
}

export function kaspaStreamBlockUrl(blockHash: string): string | undefined {
  if (!/^[0-9a-f]{64}$/i.test(blockHash)) return undefined;

  return `https://kaspa.stream/blocks/${blockHash.toLowerCase()}`;
}

export function kaspaStreamAddressUrl(address: string): string | undefined {
  if (!/^kaspa(test)?:[0-9a-z]{40,100}$/.test(address)) return undefined;

  return `https://kaspa.stream/addresses/${address}`;
}
