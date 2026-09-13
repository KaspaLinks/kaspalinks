import { z } from "zod";
import { readConfirmedGiveawayChainEntropy } from "./giveaway-chain-entropy";
import type { PrototypeEntropy, PrototypeUtxo } from "./giveaway-prize-v3-prototype";
const decimal = z
  .union([z.string().regex(/^[0-9]+$/), z.number().int().nonnegative().safe()])
  .transform(String);
const hash = z
  .string()
  .regex(/^[0-9a-f]{64}$/i)
  .transform((v) => v.toLowerCase());
async function read(path: string): Promise<unknown> {
  const response = await fetch(`https://api.kaspa.org${path}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error("Mainnet chain data is unavailable.");
  return response.json();
}
export async function readPrototypeChain() {
  const data = z
    .object({ networkName: z.literal("kaspa-mainnet"), virtualDaaScore: decimal })
    .parse(await read("/info/blockdag"));
  const score = z
    .object({ blueScore: decimal })
    .parse(await read("/info/virtual-chain-blue-score"));
  if (BigInt(data.virtualDaaScore) <= 474165565n) throw new Error("Toccata is not active.");
  return { daa: BigInt(data.virtualDaaScore), blueScore: BigInt(score.blueScore) };
}
export async function readPrototypeUtxos(address: string): Promise<PrototypeUtxo[]> {
  const rows = z
    .array(
      z.object({
        outpoint: z.object({ transactionId: hash, index: z.number().int().nonnegative() }),
        utxoEntry: z.object({ amount: decimal, blockDaaScore: decimal, isCoinbase: z.boolean() }),
      }),
    )
    .max(100)
    .parse(await read(`/addresses/${encodeURIComponent(address)}/utxos`));
  if (rows.some((r) => r.utxoEntry.isCoinbase))
    throw new Error("Coinbase inputs are not supported by this prototype.");
  return rows.map((r) => ({
    ...r.outpoint,
    amount: r.utxoEntry.amount,
    blockDaaScore: r.utxoEntry.blockDaaScore,
  }));
}
export async function readPrototypeEntropy(target: bigint): Promise<PrototypeEntropy> {
  const entropy = await readConfirmedGiveawayChainEntropy(target);
  if (!entropy.ready) throw new Error("The committed entropy target still needs confirmations.");
  return verifyPrototypeEntropy(
    {
      blockHash: entropy.blockHash,
      blockBlueScore: entropy.blockBlueScore.toString(),
      seedHex: "",
    },
    false,
  );
}
export async function verifyPrototypeEntropy(
  entropy: PrototypeEntropy,
  checkSeed = true,
): Promise<PrototypeEntropy> {
  const block = z
    .object({
      header: z.object({
        version: z.number().int().min(2),
        daaScore: decimal,
        blueScore: decimal,
        acceptedIdMerkleRoot: hash,
      }),
      verboseData: z.object({ hash, isChainBlock: z.literal(true) }),
    })
    .parse(await read(`/blocks/${entropy.blockHash}?includeTransactions=false`));
  if (
    block.verboseData.hash !== entropy.blockHash ||
    block.header.blueScore !== entropy.blockBlueScore ||
    BigInt(block.header.daaScore) < 474165565n
  ) {
    throw new Error("Entropy block no longer matches its commitment.");
  }
  // rusty-kaspa a41a333, SeqCommitAccessor::seq_commitment_within_depth returns
  // header.accepted_id_merkle_root after Toccata, NOT the block hash.
  if (checkSeed && block.header.acceptedIdMerkleRoot !== entropy.seedHex)
    throw new Error("Entropy commitment changed.");
  const chain = await readPrototypeChain();
  const depth = chain.blueScore - BigInt(entropy.blockBlueScore);
  // Conservative prototype window: 100..36,000 blue-score units, below finality depth.
  if (depth < 100n || depth >= 36_000n)
    throw new Error(
      "Entropy is not confirmed or is too old. Wait or use recovery after the deadline.",
    );
  return {
    blockHash: entropy.blockHash,
    blockBlueScore: entropy.blockBlueScore,
    seedHex: block.header.acceptedIdMerkleRoot,
  };
}

export async function readPrototypePayout(
  transactionId: string,
  manifest: { prizeSompi: string; entries: { address: string }[] },
) {
  try {
    const tx = z
      .object({
        transaction_id: hash,
        is_accepted: z.boolean(),
        outputs: z.array(z.object({ amount: decimal, script_public_key_address: z.string() })),
      })
      .parse(await read(`/transactions/${transactionId}`));
    const output = tx.outputs[0];
    return tx.transaction_id === transactionId &&
      tx.is_accepted &&
      tx.outputs.length === 1 &&
      output?.amount === manifest.prizeSompi &&
      manifest.entries.some((e) => e.address === output.script_public_key_address)
      ? { transactionId, confirmed: true, winnerAddress: output.script_public_key_address }
      : { transactionId, confirmed: false, winnerAddress: null };
  } catch {
    return { transactionId, confirmed: false, winnerAddress: null };
  }
}

/** Only call with a creator-scoped, already validated refund submission from the audit trail. */
export async function readPrototypeRefund(transactionId: string) {
  const pending = { transactionId, confirmed: false, address: null, amount: null };
  try {
    const tx = z
      .object({
        transaction_id: hash,
        is_accepted: z.boolean(),
        inputs: z.array(z.unknown()).length(1),
        outputs: z
          .array(
            z.object({
              amount: decimal,
              script_public_key_address: z.string().startsWith("kaspa:"),
            }),
          )
          .length(1),
      })
      .parse(await read(`/transactions/${transactionId}`));
    const output = tx.outputs[0]!;
    return tx.transaction_id === transactionId && tx.is_accepted && BigInt(output.amount) > 0n
      ? {
          transactionId,
          confirmed: true,
          address: output.script_public_key_address,
          amount: output.amount,
        }
      : pending;
  } catch {
    return pending;
  }
}
