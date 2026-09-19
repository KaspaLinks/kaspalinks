/** Public deterministic lab keys only; no wallet material. */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import {
  buildEscrowV1Address,
  buildEscrowV1Witness,
  escrowV1Commitment,
  type EscrowV1Parameters,
} from "../../packages/kaspa/src/escrow-v1";
import { buildEscrowV1Transaction } from "../../packages/kaspa/src/escrow-v1-transaction";
const sdk = createRequire(import.meta.url)("kaspa-wasm");
const key = (seed: string) =>
  new sdk.PrivateKey(seed.repeat(32)).toPublicKey().toXOnlyPublicKey().toString();
const parameters: EscrowV1Parameters = {
  amount: 100000000n,
  fee: 20000n,
  releaseAfter: 200000000n,
  buyerPublicKey: key("21"),
  sellerPublicKey: key("22"),
  buyerScriptPublicKey: "00005161",
  sellerScriptPublicKey: "00005162",
};
const rows = [];
for (const mode of ["release", "refund", "claim", "freeze", "settle"] as const) {
  for (const phase of (mode === "refund"
    ? ["active", "frozen"]
    : mode === "settle"
      ? ["frozen"]
      : ["active"]) as ("active" | "frozen")[]) {
    const signatures =
      mode === "settle"
        ? ["aa".repeat(64) + "01", "bb".repeat(64) + "01"]
        : ["aa".repeat(64) + "01"];
    const transaction = buildEscrowV1Transaction(
      {
        parameters,
        mode,
        phase,
        computeBudget: 2000,
        ...(mode === "settle" ? { buyerShare: 40000000n } : {}),
        utxo: {
          transactionId: "ab".repeat(32),
          index: 0,
          amount: (phase === "active"
            ? parameters.amount + parameters.fee
            : parameters.amount
          ).toString(),
          blockDaaScore: "1000",
          scriptPublicKeyHex: buildEscrowV1Address(parameters, phase).scriptPublicKeyHex,
        },
      },
      signatures,
    );
    rows.push({
      signatureScriptHex: JSON.parse(transaction.transactionSafeJson).inputs[0].signatureScript,
      mode,
      phase,
      ...buildEscrowV1Address(parameters, phase),
      ...escrowV1Commitment(parameters, phase),
      witnessHex: buildEscrowV1Witness(
        parameters,
        phase,
        mode,
        mode === "settle"
          ? ["aa".repeat(64) + "01", "bb".repeat(64) + "01"]
          : ["aa".repeat(64) + "01"],
      ),
    });
  }
}
writeFileSync(
  process.argv[2] ?? "labs/claimable-script/escrow_v1_ts_vectors.json",
  JSON.stringify(rows, null, 2) + "\n",
);
