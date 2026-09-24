import type * as Kaspa from "kaspa-wasm";

import { withEscrowSignerSecret, type EscrowSignerContext } from "@/lib/escrow-passkey-signer";
import { loadPrototypeSdk } from "../prize-covenant/browser";

export type PreparedMediatedEscrow = {
  feeSompi: string;
  review: {
    buyerShareSompi: string | null;
    computeBudget: number;
    feeSompi: string;
    fundingOutputIndex: number;
    fundingTransactionId: string;
    mediatorParty: "buyer" | "seller" | null;
    mode: "agree" | "arbitrate" | "claim" | "fallbackSeller" | "freeze" | "refund" | "release";
    netAmountSompi: string;
    outputs: Array<{
      amountSompi: string;
      recipient: "buyer" | "frozen-contract" | "seller";
      recipientAddress: string;
    }>;
    phase: "active" | "frozen";
    requiredRoles: Array<"buyer" | "mediator" | "seller">;
    sequenceDelayDaa: string;
  };
  transactionSafeJson: string;
  unsigned: boolean;
};

type SafeJson = {
  id?: string;
  inputs: Array<{
    computeBudget: number;
    index: number;
    sequence: string;
    signatureScript: string;
    transactionId: string;
    utxo: { amount: string };
  }>;
  mass?: string;
  outputs: Array<{
    scriptPublicKey: string | { script: string; version: number };
    value: string;
  }>;
};

const EMPTY_SIGNATURE_PUSH = `41${"00".repeat(64)}01`;

function normalized(sdk: typeof Kaspa, value: string): SafeJson {
  return JSON.parse(
    sdk.Transaction.deserializeFromSafeJSON(value).serializeToSafeJSON(),
  ) as SafeJson;
}

function canonicalIntent(sdk: typeof Kaspa, value: string): string {
  const transaction = normalized(sdk, value);
  delete transaction.id;
  delete transaction.mass;
  if (transaction.inputs.length !== 1) throw new Error("Expected one mediated escrow input.");
  transaction.inputs[0]!.signatureScript = "";
  return JSON.stringify(transaction);
}

function scriptPublicKeyHex(value: SafeJson["outputs"][number]["scriptPublicKey"]): string {
  if (typeof value === "string") return value.toLowerCase();
  return `${value.version.toString(16).padStart(4, "0")}${value.script}`.toLowerCase();
}

function assertPreparedIntent(sdk: typeof Kaspa, prepared: PreparedMediatedEscrow) {
  const transaction = normalized(sdk, prepared.transactionSafeJson);
  const input = transaction.inputs[0];
  const review = prepared.review;
  if (
    transaction.inputs.length !== 1 ||
    !input ||
    input.transactionId !== review.fundingTransactionId ||
    input.index !== review.fundingOutputIndex ||
    input.computeBudget !== review.computeBudget ||
    input.sequence !== review.sequenceDelayDaa ||
    transaction.outputs.length !== review.outputs.length ||
    BigInt(input.utxo.amount) -
      transaction.outputs.reduce((sum, output) => sum + BigInt(output.value), 0n) !==
      BigInt(review.feeSompi)
  ) {
    throw new Error("Prepared transaction differs from the displayed mediated escrow intent.");
  }
  for (const [index, expected] of review.outputs.entries()) {
    const actual = transaction.outputs[index];
    if (!actual || actual.value !== expected.amountSompi) {
      throw new Error("Prepared mediated escrow payout amount changed.");
    }
    const destination = sdk.payToAddressScript(expected.recipientAddress).toJSON() as {
      script: string;
      version: number;
    };
    if (scriptPublicKeyHex(actual.scriptPublicKey) !== scriptPublicKeyHex(destination)) {
      throw new Error("Prepared mediated escrow recipient changed.");
    }
  }
  const signatureCount = review.requiredRoles.length;
  for (let slot = 0; slot < signatureCount; slot += 1) {
    if (!/^41[0-9a-f]{128}01$/u.test(input.signatureScript.slice(slot * 132, (slot + 1) * 132))) {
      throw new Error("Prepared mediated escrow has an invalid signature template.");
    }
  }
}

export async function signPreparedMediatedEscrow(input: {
  context: EscrowSignerContext;
  expectedPublicKey: string;
  prepared: PreparedMediatedEscrow;
  prfOutput: Uint8Array;
  role: "buyer" | "mediator" | "seller";
  sdk?: typeof Kaspa;
}): Promise<{ complete: boolean; transactionId: string; transactionSafeJson: string }> {
  const sdk = input.sdk ?? (await loadPrototypeSdk());
  assertPreparedIntent(sdk, input.prepared);
  const slot = input.prepared.review.requiredRoles.indexOf(input.role);
  if (slot < 0) throw new Error("This role cannot sign the prepared mediated escrow action.");
  if (input.context.role !== input.role)
    throw new Error("Passkey context does not match this role.");
  const before = canonicalIntent(sdk, input.prepared.transactionSafeJson);

  return withEscrowSignerSecret(input.prfOutput, input.context, async (secretKey) => {
    const key = new sdk.PrivateKey(
      Array.from(secretKey, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
    try {
      if (key.toPublicKey().toXOnlyPublicKey().toString() !== input.expectedPublicKey) {
        throw new Error("Passkey signer does not match this mediated escrow role.");
      }
      const transaction = sdk.Transaction.deserializeFromSafeJSON(
        input.prepared.transactionSafeJson,
      );
      const current = transaction.inputs[0];
      if (!current?.signatureScript) throw new Error("Prepared mediated escrow input is missing.");
      const offset = slot * 132;
      if (current.signatureScript.slice(offset, offset + 132) !== EMPTY_SIGNATURE_PUSH) {
        throw new Error("This mediated escrow signature slot is already occupied.");
      }
      const signaturePush = sdk.createInputSignature(transaction, 0, key, sdk.SighashType.All);
      if (!/^41[0-9a-f]{128}01$/u.test(signaturePush)) {
        throw new Error("Kaspa WASM returned an invalid SIGHASH_ALL signature.");
      }
      current.signatureScript =
        current.signatureScript.slice(0, offset) +
        signaturePush +
        current.signatureScript.slice(offset + 132);
      transaction.finalize();
      const transactionSafeJson = transaction.serializeToSafeJSON();
      if (canonicalIntent(sdk, transactionSafeJson) !== before) {
        throw new Error("Signing changed the reviewed mediated escrow intent.");
      }
      const normalizedTransaction = normalized(sdk, transactionSafeJson);
      const complete = input.prepared.review.requiredRoles.every((_, index) => {
        const push = normalizedTransaction.inputs[0]!.signatureScript.slice(
          index * 132,
          (index + 1) * 132,
        );
        return /^41[0-9a-f]{128}01$/u.test(push) && push !== EMPTY_SIGNATURE_PUSH;
      });
      return { complete, transactionId: transaction.id, transactionSafeJson };
    } finally {
      key.free();
    }
  });
}
