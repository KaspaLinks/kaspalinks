import { createRequire } from "node:module";
import { z } from "zod";
import { buildGiveawayPrizeV3Address, GIVEAWAY_PRIZE_V3_DISPATCH_TAGS } from "@kaspa-actions/kaspa";
import {
  giveawayV3Draw,
  giveawayV3EntryHash,
  giveawayV3EntriesRoot,
  giveawayV3FrozenStateHash,
  giveawayV3OpenStateHash,
  giveawayV3ParamsHash,
} from "./giveaway-prize-v3-proof";

const kaspa = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,15})$/);
export const PROTOTYPE_COMPUTE_BUDGET = 50;
// Covers the tested 50-unit budget (5,000 grams), with room for byte mass.
// Fixed before funding because the draw output commits to the exact prize.
export const PROTOTYPE_FEE_SOMPI = 1_000_000n;
export const prototypeCreateSchema = z
  .object({
    durationMinutes: z
      .union([
        z.literal(5),
        z.literal(15),
        z.literal(30),
        z.literal(60),
        z.literal(360),
        z.literal(720),
        z.literal(1440),
      ])
      .optional(),
    publicTitle: z.string().trim().min(3).max(100).optional(),
    creatorPublicKeyHex: hex32,
    prizeSompi: decimal.refine(
      (v) => BigInt(v) >= 20_000_000n && BigInt(v) <= 100_000_000n,
      "Prototype prize must be between 0.2 and 1 KAS.",
    ),
    addresses: z.array(z.string().trim().min(20).max(150)).max(100),
  })
  .strict()
  .refine(
    (v) => (v.publicTitle ? v.addresses.length === 0 : v.addresses.length >= 2),
    "Public giveaways start with an empty list; fixed trials need at least two addresses.",
  );
export const prototypeManifestSchema = z
  .object({
    version: z.literal(3),
    network: z.literal("mainnet"),
    creatorPublicKeyHex: hex32,
    platformPublicKeyHex: hex32,
    prizeSompi: decimal,
    drawFeeSompi: z.literal("1000000"),
    freezeFeeSompi: z.literal("1000000"),
    closesAtDaa: decimal,
    refundDaa: decimal,
    entropyTargetBlueScore: decimal,
    entries: z
      .array(
        z
          .object({
            address: z.string(),
            scriptPublicKeyHex: z.string().regex(/^0000[0-9a-f]+$/),
            hash: hex32,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type PrototypeManifest = z.infer<typeof prototypeManifestSchema>;
export const prototypeEntropySchema = z
  .object({ blockHash: hex32, blockBlueScore: decimal, seedHex: hex32 })
  .strict();
export type PrototypeEntropy = z.infer<typeof prototypeEntropySchema>;
export type PrototypeUtxo = {
  transactionId: string;
  index: number;
  amount: string;
  blockDaaScore: string;
};
export type PrototypeMode = "freeze" | "draw" | "refund";

function addressScript(address: string): string {
  const parsed = new kaspa.Address(address);
  if (parsed.prefix !== "kaspa") throw new Error("Only mainnet addresses are supported.");
  const spk = kaspa.payToAddressScript(parsed);
  return "0000" + spk.script;
}

export function createPrototypeManifest(
  input: z.infer<typeof prototypeCreateSchema>,
  chain: {
    daa: bigint;
    blueScore: bigint;
    platformPublicKeyHex: string;
  },
): PrototypeManifest {
  // Parsing as an x-only curve point prevents funding a permanently unrefundable key.
  new kaspa.XOnlyPublicKey(input.creatorPublicKeyHex);
  const entries = prototypeEntries(input.addresses);
  const duration = BigInt(input.durationMinutes ?? 5) * 600n;
  return prototypeManifestSchema.parse({
    creatorPublicKeyHex: input.creatorPublicKeyHex,
    prizeSompi: input.prizeSompi,
    version: 3,
    network: "mainnet",
    platformPublicKeyHex: chain.platformPublicKeyHex,
    entries,
    drawFeeSompi: PROTOTYPE_FEE_SOMPI.toString(),
    freezeFeeSompi: PROTOTYPE_FEE_SOMPI.toString(),
    closesAtDaa: (chain.daa + duration).toString(),
    refundDaa: (chain.daa + duration + 33_000n).toString(),
    entropyTargetBlueScore: (chain.blueScore + duration + 600n).toString(),
  });
}

export function prototypeEntries(addresses: string[]) {
  const entries = addresses
    .map((address) => {
      const scriptPublicKeyHex = addressScript(address);
      return { address, scriptPublicKeyHex, hash: giveawayV3EntryHash(scriptPublicKeyHex) };
    })
    .sort((a, b) => a.hash.localeCompare(b.hash));
  if (new Set(entries.map((e) => e.hash)).size !== entries.length)
    throw new Error("Each payout address may enter only once.");
  return entries;
}

export function prototypeTerms(m: PrototypeManifest) {
  const paramsHashHex = giveawayV3ParamsHash({
    prizeSompi: BigInt(m.prizeSompi),
    drawFeeSompi: BigInt(m.drawFeeSompi),
    closesAtDaa: BigInt(m.closesAtDaa),
    refundDaa: BigInt(m.refundDaa),
    creatorPublicKeyHex: m.creatorPublicKeyHex,
  });
  const entriesRootHex = m.entries.length
    ? giveawayV3EntriesRoot(m.entries.map((e) => e.hash))
    : "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const open = buildGiveawayPrizeV3Address({
    platformPublicKeyHex: m.platformPublicKeyHex,
    stateHashHex: giveawayV3OpenStateHash(paramsHashHex),
  });
  const frozen = buildGiveawayPrizeV3Address({
    platformPublicKeyHex: m.platformPublicKeyHex,
    stateHashHex: giveawayV3FrozenStateHash(paramsHashHex, entriesRootHex),
  });
  return {
    paramsHashHex,
    entriesRootHex,
    open,
    frozen,
    fundingSompi: (
      BigInt(m.prizeSompi) +
      BigInt(m.drawFeeSompi) +
      BigInt(m.freezeFeeSompi)
    ).toString(),
  };
}

function le8(value: string): string {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b.toString("hex");
}

export function prototypeWitness(
  m: PrototypeManifest,
  mode: PrototypeMode,
  phase: "open" | "frozen",
  signatureHex: string,
  entropy?: PrototypeEntropy,
): { signatureScriptHex: string; winnerAddress: string | null } {
  if (!new RegExp(`^[0-9a-f]{${mode === "refund" ? 130 : 128}}$`).test(signatureHex))
    throw new Error("Invalid signature length.");
  const terms = prototypeTerms(m);
  const args = [
    signatureHex,
    le8(m.prizeSompi),
    le8(m.drawFeeSompi),
    le8(m.closesAtDaa),
    le8(m.refundDaa),
    m.creatorPublicKeyHex,
  ];
  let winnerAddress: string | null = null;
  if (mode === "freeze") args.push(terms.entriesRootHex, "00".repeat(32));
  if (mode === "draw") {
    if (!entropy) throw new Error("Confirmed entropy is required.");
    const draw = giveawayV3Draw({
      seedHex: entropy.seedHex,
      sortedEntryHashes: m.entries.map((e) => e.hash),
    });
    const winner = m.entries[draw.winnerIndex];
    if (!winner) throw new Error("Winner is missing.");
    winnerAddress = winner.address;
    args.push(
      terms.entriesRootHex,
      entropy.blockHash,
      m.entries.map((e) => e.hash).join(""),
      winner.scriptPublicKeyHex,
    );
  }
  if (mode === "refund")
    args.push(
      phase === "open" ? "00" : "01",
      phase === "open" ? "00".repeat(32) : terms.entriesRootHex,
    );
  const witness = new kaspa.ScriptBuilder({ flags: { covenantsEnabled: true } });
  args.forEach((arg) => witness.addData(arg));
  witness.addData(GIVEAWAY_PRIZE_V3_DISPATCH_TAGS[mode]);
  // The legacy free function uses pre-Toccata limits and rejects this 746-byte script.
  const redeem = kaspa.ScriptBuilder.fromScript(terms[phase].redeemScriptHex, {
    flags: { covenantsEnabled: true },
  });
  return {
    signatureScriptHex: redeem.encodePayToScriptHashSignatureScript(witness.drain()),
    winnerAddress,
  };
}

export function buildPrototypeTransaction(input: {
  manifest: PrototypeManifest;
  mode: PrototypeMode;
  phase: "open" | "frozen";
  utxo: PrototypeUtxo;
  signatureHex: string;
  entropy?: PrototypeEntropy;
  refundAddress?: string;
}) {
  const { manifest: m, mode, phase, utxo } = input;
  if ((mode === "freeze" && phase !== "open") || (mode === "draw" && phase !== "frozen"))
    throw new Error("Wrong covenant phase.");
  const terms = prototypeTerms(m);
  const expectedAmount =
    phase === "open"
      ? terms.fundingSompi
      : (BigInt(m.prizeSompi) + BigInt(m.drawFeeSompi)).toString();
  if (mode !== "refund" && utxo.amount !== expectedAmount)
    throw new Error("Funding amount must match the prototype exactly.");
  const witness = prototypeWitness(m, mode, phase, input.signatureHex, input.entropy);
  const outputScript =
    mode === "freeze"
      ? terms.frozen.scriptPublicKeyHex
      : addressScript(mode === "draw" ? witness.winnerAddress! : (input.refundAddress ?? ""));
  if (BigInt(utxo.amount) <= PROTOTYPE_FEE_SOMPI)
    throw new Error("Output cannot cover the reserved recovery fee.");
  const value =
    mode === "draw" ? m.prizeSompi : (BigInt(utxo.amount) - PROTOTYPE_FEE_SOMPI).toString();
  const spk = (hex: string) => ({ version: 0, script: hex.slice(4) });
  const tx = kaspa.Transaction.deserializeFromSafeJSON(
    JSON.stringify({
      version: 1,
      id: "00".repeat(32),
      gas: "0",
      payload: "",
      subnetworkId: "00".repeat(20),
      lockTime: mode === "freeze" ? m.closesAtDaa : mode === "refund" ? m.refundDaa : "0",
      inputs: [
        {
          transactionId: utxo.transactionId,
          index: utxo.index,
          computeBudget: PROTOTYPE_COMPUTE_BUDGET,
          sigOpCount: 0,
          sequence: "0",
          signatureScript: witness.signatureScriptHex,
          utxo: {
            amount: utxo.amount,
            blockDaaScore: utxo.blockDaaScore,
            isCoinbase: false,
            scriptPublicKey: spk(terms[phase].scriptPublicKeyHex),
          },
        },
      ],
      outputs: [{ value, scriptPublicKey: spk(outputScript) }],
    }),
  );
  tx.finalize();
  // Consensus size accounting: fixed fields + one v1 input + one ordinary output.
  const bytes =
    166n + BigInt(witness.signatureScriptHex.length / 2) + BigInt(outputScript.length / 2 - 2);
  const computeMass =
    bytes + BigInt(outputScript.length / 2) * 10n + BigInt(PROTOTYPE_COMPUTE_BUDGET) * 100n;
  const minimumFee = 100n * (computeMass > bytes * 2n ? computeMass : bytes * 2n);
  if (BigInt(utxo.amount) - BigInt(value) < minimumFee)
    throw new Error("Reserved fee is below the mainnet relay minimum.");
  return {
    transactionSafeJson: tx.serializeToSafeJSON(),
    transactionId: tx.id,
    winnerAddress: witness.winnerAddress,
    feeSompi: (BigInt(utxo.amount) - BigInt(value)).toString(),
    minimumFeeSompi: minimumFee.toString(),
  };
}

/** Accept only the locally signed refund of the server-reconstructed intent. */
export function validatePrototypeRefundTransaction(
  safeJson: string,
  expectedSafeJson: string,
): string {
  const actual = kaspa.Transaction.deserializeFromSafeJSON(safeJson);
  const expected = kaspa.Transaction.deserializeFromSafeJSON(expectedSafeJson);
  actual.finalize();
  expected.finalize();
  const a = JSON.parse(actual.serializeToSafeJSON());
  const b = JSON.parse(expected.serializeToSafeJSON());
  const sig = a.inputs?.[0]?.signatureScript;
  if (typeof sig !== "string" || !/^41[0-9a-f]{128}01/.test(sig))
    throw new Error("Refund must use SIGHASH_ALL.");
  a.id = b.id;
  a.inputs[0].signatureScript = "41" + "00".repeat(65) + sig.slice(132);
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error("Signed refund differs from the reviewed recovery intent.");
  return actual.serializeToSafeJSON();
}
