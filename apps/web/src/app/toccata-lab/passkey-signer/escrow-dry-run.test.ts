import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { deriveEscrowSignerPublicIdentity } from "@/lib/escrow-passkey-signer";
import { runEscrowPasskeyDryRun } from "./escrow-dry-run";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const context = {
  escrowId: "passkey-lab-example",
  network: "mainnet",
  role: "buyer",
  signerVersion: 1,
} as const;

describe("passkey escrow dry run", () => {
  it("builds and signs an offline release bound to the derived buyer key", async () => {
    const prf = new Uint8Array(32).fill(7);
    const identity = await deriveEscrowSignerPublicIdentity(prf, context);
    const result = await runEscrowPasskeyDryRun(prf, context, sdk);
    const transaction = JSON.parse(result.transactionSafeJson);

    expect(result.publicKey).toBe(identity.publicKey);
    expect(result).toMatchObject({
      amountSompi: "100000000",
      broadcast: false,
      feeSompi: "20000",
      intentVerified: true,
      signedInBrowser: true,
    });
    expect(result.fundingAddress).toMatch(/^kaspa:/u);
    expect(result.transactionId).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.signatureScriptBytes).toBeGreaterThan(1_100);
    expect(transaction.inputs[0].signatureScript).not.toContain("00".repeat(64) + "01");
    expect(BigInt(transaction.inputs[0].utxo.amount) - BigInt(transaction.outputs[0].value)).toBe(
      20_000n,
    );
  });
});
