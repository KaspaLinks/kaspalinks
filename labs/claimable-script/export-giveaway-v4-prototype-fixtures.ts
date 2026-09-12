/** Offline cross-language vectors. These fixed TEST keys never fund an address. */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import {
  buildPrototypeTransaction,
  createPrototypeManifest,
  prototypeTerms,
} from "../../apps/web/src/lib/giveaway-prize-v3-prototype";
import {
  giveawayPrizeV3PlatformPublicKey,
  signGiveawayV3EntriesAttestation,
  signGiveawayV3EntropyAttestation,
} from "../../apps/web/src/lib/giveaway-prize-v3-attest";
import { signPrototypeRefund } from "../../apps/web/src/app/toccata-lab/prize-covenant/browser";
const sdk = createRequire(new URL("../../apps/web/package.json", import.meta.url))("kaspa-wasm");
async function main() {
  process.env.GIVEAWAY_PLATFORM_SIGNING_KEY = "11".repeat(32);
  const creator = new sdk.PrivateKey("22".repeat(32));
  const manifest = createPrototypeManifest(
    {
      creatorPublicKeyHex: creator.toPublicKey().toXOnlyPublicKey().toString(),
      prizeSompi: "100000000",
      addresses: Array.from({ length: 100 }, (_, i) => (i + 1).toString(16).padStart(64, "0")).map(
        (k) => new sdk.PrivateKey(k).toPublicKey().toAddress("mainnet").toString(),
      ),
    },
    {
      daa: 536000000n,
      blueScore: 535000000n,
      platformPublicKeyHex: giveawayPrizeV3PlatformPublicKey(),
    },
  );
  manifest.version = 4;
  const terms = prototypeTerms(manifest);
  const entropy = {
    blockHash: "7a".repeat(32),
    seedHex: "5c".repeat(32),
    blockBlueScore: manifest.entropyTargetBlueScore,
  };
  const vectors = [];
  for (const [mode, phase] of [
    ["freeze", "open"],
    ["draw", "frozen"],
    ["refund", "open"],
    ["refund", "frozen"],
  ] as const) {
    const signatureHex =
      mode === "freeze"
        ? signGiveawayV3EntriesAttestation({
            ...terms,
            expectedPlatformPublicKeyHex: manifest.platformPublicKeyHex,
          })
        : mode === "draw"
          ? signGiveawayV3EntropyAttestation({
              paramsHashHex: terms.paramsHashHex,
              blockHashHex: entropy.blockHash,
              expectedPlatformPublicKeyHex: manifest.platformPublicKeyHex,
            })
          : "00".repeat(65);
    const prepared = buildPrototypeTransaction({
      manifest,
      mode,
      phase,
      signatureHex,
      entropy,
      refundAddress: creator.toPublicKey().toAddress("mainnet").toString(),
      utxo: {
        transactionId: "ab".repeat(32),
        index: 0,
        amount: phase === "open" ? "102000000" : "101000000",
        blockDaaScore: "536000100",
      },
    });
    const safeJson =
      mode === "refund"
        ? await signPrototypeRefund(
            {
              transactionSafeJson: prepared.transactionSafeJson,
              privateKeyHex: "22".repeat(32),
              publicKeyHex: manifest.creatorPublicKeyHex,
              refundAddress: creator.toPublicKey().toAddress("mainnet").toString(),
            },
            sdk,
          )
        : prepared.transactionSafeJson;
    vectors.push({
      mode,
      phase,
      minimumFeeSompi: prepared.minimumFeeSompi,
      transaction: JSON.parse(safeJson),
    });
  }
  for (const [mode, phase, empty, lockOverride] of [
    ["freeze", "open", true, null],
    ["refund", "frozen", true, null],
    ["refund", "open", true, manifest.closesAtDaa],
    ["refund", "frozen", false, manifest.closesAtDaa],
    ["refund", "frozen", true, (BigInt(manifest.closesAtDaa) - 1n).toString()],
    ["draw", "frozen", false, null],
  ] as const) {
    const m = {
      ...manifest,
      entries: empty ? [] : mode === "draw" ? manifest.entries.slice(0, 1) : manifest.entries,
    };
    const t = prototypeTerms(m);
    const signatureHex =
      mode === "freeze"
        ? signGiveawayV3EntriesAttestation({
            ...t,
            expectedPlatformPublicKeyHex: m.platformPublicKeyHex,
          })
        : mode === "draw"
          ? signGiveawayV3EntropyAttestation({
              paramsHashHex: t.paramsHashHex,
              blockHashHex: entropy.blockHash,
              expectedPlatformPublicKeyHex: m.platformPublicKeyHex,
            })
          : "00".repeat(65);
    const prepared = buildPrototypeTransaction({
      manifest: m,
      mode,
      phase,
      signatureHex,
      entropy,
      refundAddress: creator.toPublicKey().toAddress("mainnet").toString(),
      utxo: {
        transactionId: "ab".repeat(32),
        index: 0,
        amount: phase === "open" ? "102000000" : "101000000",
        blockDaaScore: "536000100",
      },
    });
    const json = JSON.parse(prepared.transactionSafeJson);
    if (lockOverride) json.lockTime = lockOverride;
    const safeJson =
      mode === "refund"
        ? await signPrototypeRefund(
            {
              transactionSafeJson: JSON.stringify(json),
              privateKeyHex: "22".repeat(32),
              publicKeyHex: m.creatorPublicKeyHex,
              refundAddress: creator.toPublicKey().toAddress("mainnet").toString(),
            },
            sdk,
          )
        : prepared.transactionSafeJson;
    vectors.push({
      mode,
      phase,
      minimumFeeSompi: prepared.minimumFeeSompi,
      transaction: JSON.parse(safeJson),
    });
  }
  writeFileSync(
    new URL("./giveaway_prize_v4_prototype_vectors.json", import.meta.url),
    JSON.stringify({ manifest, entropy, vectors }, null, 2) + "\n",
  );
  console.log("Wrote 10 offline V4 prototype vectors; no network access or funding.");
}
void main();
