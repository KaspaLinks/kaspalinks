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
  writeFileSync(
    new URL("./giveaway_prize_v3_prototype_vectors.json", import.meta.url),
    JSON.stringify({ manifest, entropy, vectors }, null, 2) + "\n",
  );
  console.log("Wrote 4 offline prototype vectors; no network access or funding.");
}
void main();
