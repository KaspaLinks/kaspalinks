import type * as Kaspa from "kaspa-wasm";

import { withEscrowSignerSecret, type EscrowSignerContext } from "@/lib/escrow-passkey-signer";
import { loadPrototypeSdk } from "../prize-covenant/browser";

export type EscrowCanaryMode = "claim" | "refund" | "release";

export type EscrowCanary = {
  activeFundingAddress: string;
  amountSompi: string;
  buyerPublicKey: string;
  chainDaa: string;
  claimAvailable: boolean;
  feeSompi: string;
  frozenFundingAddress: string;
  funding: {
    state: "ambiguous" | "awaiting_funding" | "funded";
    unexpectedOutputCount: number;
  };
  fundingAmountSompi: string;
  id: string;
  payoutAddress: string;
  releaseAfter: string;
  sellerPublicKey: string;
  signerContextId: string;
  status: string;
  submitted: null | { mode: EscrowCanaryMode; transactionId: string };
};

export type PreparedEscrowCanary = {
  feeSompi: string;
  review: {
    amountSompi: string;
    computeBudget: number;
    destinationAddress: string;
    feeSompi: string;
    fundingOutputIndex: number;
    fundingTransactionId: string;
    lockTime: string;
    mode: EscrowCanaryMode;
    requiredRole: "buyer" | "seller";
  };
  transactionSafeJson: string;
  unsigned: boolean;
};

type SafeJson = {
  id?: string;
  inputs: Array<{
    computeBudget: number;
    index: number;
    signatureScript: string;
    transactionId: string;
    utxo: { amount: string };
  }>;
  lockTime: string;
  outputs: Array<{ scriptPublicKey: string | { script: string; version: number }; value: string }>;
};

const EMPTY_SIGNATURE_PUSH = `41${"00".repeat(64)}01`;

function canonicalIntent(sdk: typeof Kaspa, safeJson: string): string {
  const value = JSON.parse(
    sdk.Transaction.deserializeFromSafeJSON(safeJson).serializeToSafeJSON(),
  ) as SafeJson;
  delete value.id;
  const massValue = value as SafeJson & { mass?: string };
  delete massValue.mass;
  if (value.inputs.length !== 1) throw new Error("Expected one escrow input.");
  value.inputs[0]!.signatureScript = "";
  return JSON.stringify(value);
}

function scriptPublicKeyHex(value: SafeJson["outputs"][number]["scriptPublicKey"]): string {
  if (typeof value === "string") return value.toLowerCase();
  return `${value.version.toString(16).padStart(4, "0")}${value.script}`.toLowerCase();
}

function assertReviewedIntent(
  sdk: typeof Kaspa,
  transactionSafeJson: string,
  review: PreparedEscrowCanary["review"],
) {
  const parsed = JSON.parse(
    sdk.Transaction.deserializeFromSafeJSON(transactionSafeJson).serializeToSafeJSON(),
  ) as SafeJson;
  const input = parsed.inputs[0];
  const output = parsed.outputs[0];
  const destination = sdk.payToAddressScript(review.destinationAddress).toJSON() as {
    script: string;
    version: number;
  };
  if (
    parsed.inputs.length !== 1 ||
    parsed.outputs.length !== 1 ||
    !input ||
    !output ||
    input.transactionId !== review.fundingTransactionId ||
    input.index !== review.fundingOutputIndex ||
    input.computeBudget !== review.computeBudget ||
    BigInt(input.utxo.amount) - BigInt(output.value) !== BigInt(review.feeSompi) ||
    output.value !== review.amountSompi ||
    scriptPublicKeyHex(output.scriptPublicKey) !== scriptPublicKeyHex(destination) ||
    parsed.lockTime !== review.lockTime
  ) {
    throw new Error("Prepared transaction differs from the displayed escrow intent.");
  }
  if (review.mode === "claim" && BigInt(parsed.lockTime) <= 0n) {
    throw new Error("Claim transaction is missing its deadline.");
  }
  if (!input.signatureScript.startsWith(EMPTY_SIGNATURE_PUSH)) {
    throw new Error("Prepared transaction has no empty passkey signature slot.");
  }
}

export async function signPreparedEscrowCanary(input: {
  context: EscrowSignerContext;
  expectedPublicKey: string;
  prepared: PreparedEscrowCanary;
  prfOutput: Uint8Array;
  sdk?: typeof Kaspa;
}): Promise<{ transactionId: string; transactionSafeJson: string }> {
  const sdk = input.sdk ?? (await loadPrototypeSdk());
  assertReviewedIntent(sdk, input.prepared.transactionSafeJson, input.prepared.review);
  const before = canonicalIntent(sdk, input.prepared.transactionSafeJson);

  return withEscrowSignerSecret(input.prfOutput, input.context, async (secretKey) => {
    const key = new sdk.PrivateKey(
      Array.from(secretKey, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
    try {
      if (key.toPublicKey().toXOnlyPublicKey().toString() !== input.expectedPublicKey) {
        throw new Error("Passkey signer does not match this funded escrow.");
      }
      const transaction = sdk.Transaction.deserializeFromSafeJSON(
        input.prepared.transactionSafeJson,
      );
      const current = transaction.inputs[0];
      if (!current?.signatureScript?.startsWith(EMPTY_SIGNATURE_PUSH)) {
        throw new Error("Prepared escrow signature slot is occupied.");
      }
      const signaturePush = sdk.createInputSignature(transaction, 0, key, sdk.SighashType.All);
      if (!/^41[0-9a-f]{128}01$/u.test(signaturePush)) {
        throw new Error("Kaspa WASM returned an invalid SIGHASH_ALL signature.");
      }
      current.signatureScript = signaturePush + current.signatureScript.slice(132);
      transaction.finalize();
      const transactionSafeJson = transaction.serializeToSafeJSON();
      if (canonicalIntent(sdk, transactionSafeJson) !== before) {
        throw new Error("Signing changed the reviewed escrow intent.");
      }
      return { transactionId: transaction.id, transactionSafeJson };
    } finally {
      key.free();
    }
  });
}
