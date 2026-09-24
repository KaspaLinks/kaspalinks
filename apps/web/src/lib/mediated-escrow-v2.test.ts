import { createRequire } from "node:module";

import { buildEscrowV2Address, ESCROW_V2_TEMPLATE_HASH } from "@kaspa-actions/kaspa";
import { describe, expect, it } from "vitest";

import {
  createMediatedEscrowTerms,
  MEDIATED_ESCROW_AMOUNT_SOMPI,
  MEDIATED_ESCROW_FALLBACK_DAA,
  MEDIATED_ESCROW_FEE_SOMPI,
  MEDIATED_ESCROW_FUNDING_SOMPI,
  MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI,
  mediatedEscrowCreateSchema,
  mediatedEscrowParameters,
  mediatedEscrowPublicActionSchema,
  mediatedEscrowRequiredRoles,
  prepareMediatedEscrowTransaction,
  selectMediatedEscrowUtxo,
  validateMediatedEscrowSignatures,
  type MediatedEscrowMode,
  type MediatedEscrowStoredRecord,
} from "./mediated-escrow-v2";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const buyer = new sdk.PrivateKey("21".repeat(32));
const seller = new sdk.PrivateKey("22".repeat(32));
const mediator = new sdk.PrivateKey("23".repeat(32));
const publicKey = (key: typeof buyer) => key.toPublicKey().toXOnlyPublicKey().toString();
const address = (key: typeof buyer) => key.toPublicKey().toAddress("mainnet").toString();

function row(): MediatedEscrowStoredRecord {
  const terms = createMediatedEscrowTerms({
    buyerAddress: address(buyer),
    buyerPublicKey: publicKey(buyer),
    claimDelayDaa: 6_048_000n,
    mediatorPublicKey: publicKey(mediator),
    sellerAddress: address(seller),
    sellerPublicKey: publicKey(seller),
  });
  return {
    activeFundingAddress: terms.active.address,
    agreementTxId: null,
    amountSompi: MEDIATED_ESCROW_AMOUNT_SOMPI,
    arbitrationTxId: null,
    buyerAddress: address(buyer),
    buyerPublicKey: publicKey(buyer),
    claimDelayDaa: 6_048_000n,
    claimTxId: null,
    contractTemplateHash: ESCROW_V2_TEMPLATE_HASH,
    fallbackDelayDaa: MEDIATED_ESCROW_FALLBACK_DAA,
    fallbackTxId: null,
    feeSompi: MEDIATED_ESCROW_FEE_SOMPI,
    freezeTxId: null,
    frozenFundingAddress: terms.frozen.address,
    mediatorPublicKey: publicKey(mediator),
    refundTxId: null,
    releaseTxId: null,
    sellerAddress: address(seller),
    sellerPublicKey: publicKey(seller),
  };
}

function utxo(record: MediatedEscrowStoredRecord, phase: "active" | "frozen") {
  const parameters = mediatedEscrowParameters(record);
  return {
    amount: (phase === "active"
      ? MEDIATED_ESCROW_FUNDING_SOMPI
      : MEDIATED_ESCROW_AMOUNT_SOMPI
    ).toString(),
    blockDaaScore: "1000",
    index: 0,
    scriptPublicKeyHex: buildEscrowV2Address(parameters, phase).scriptPublicKeyHex,
    transactionId: (phase === "active" ? "ab" : "cd").repeat(32),
  };
}

function signedJson(input: {
  buyerShareSompi?: bigint;
  mediatorParty?: "buyer" | "seller";
  mode: MediatedEscrowMode;
}) {
  const record = row();
  const phase = ["agree", "arbitrate", "fallbackSeller"].includes(input.mode) ? "frozen" : "active";
  const prepared = prepareMediatedEscrowTransaction({
    ...input,
    row: record,
    utxo: utxo(record, phase),
  });
  const transaction = sdk.Transaction.deserializeFromSafeJSON(prepared.transactionSafeJson);
  const keys = mediatedEscrowRequiredRoles(input.mode, input.mediatorParty).map((role) =>
    role === "buyer" ? buyer : role === "seller" ? seller : mediator,
  );
  const original = transaction.inputs[0]!.signatureScript!;
  const pushes = keys.map((key) =>
    sdk.createInputSignature(transaction, 0, key, sdk.SighashType.All),
  );
  transaction.inputs[0]!.signatureScript = pushes.join("") + original.slice(pushes.length * 132);
  transaction.finalize();
  return {
    prepared,
    record,
    transactionSafeJson: transaction.serializeToSafeJSON(),
    utxo: utxo(record, phase),
  };
}

describe("mediated escrow V2 domain", () => {
  it("commits all three roles and the fixed 30-day fallback to distinct addresses", () => {
    const record = row();
    expect(record.activeFundingAddress).toMatch(/^kaspa:/u);
    expect(record.frozenFundingAddress).toMatch(/^kaspa:/u);
    expect(record.frozenFundingAddress).not.toBe(record.activeFundingAddress);
    expect(mediatedEscrowParameters(record).fallbackDelayDaa).toBe(25_920_000n);
    expect(() =>
      mediatedEscrowParameters({ ...record, mediatorPublicKey: record.buyerPublicKey }),
    ).toThrow(/distinct/);
  });

  it("maps every contract path to the right phase and signer roles", () => {
    const cases: Array<{
      mode: MediatedEscrowMode;
      phase: "active" | "frozen";
      roles: string[];
      buyerShareSompi?: bigint;
      mediatorParty?: "buyer" | "seller";
    }> = [
      { mode: "release", phase: "active", roles: ["buyer"] },
      { mode: "refund", phase: "active", roles: ["seller"] },
      { mode: "claim", phase: "active", roles: ["seller"] },
      { mode: "freeze", phase: "active", roles: ["buyer"] },
      { mode: "fallbackSeller", phase: "frozen", roles: ["seller"] },
      { mode: "agree", phase: "frozen", roles: ["buyer", "seller"], buyerShareSompi: 10_000_000n },
      {
        mode: "arbitrate",
        phase: "frozen",
        roles: ["buyer", "mediator"],
        buyerShareSompi: MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI,
        mediatorParty: "buyer",
      },
    ];
    for (const current of cases) {
      const record = row();
      const result = prepareMediatedEscrowTransaction({
        ...current,
        row: record,
        utxo: utxo(record, current.phase),
      });
      expect(result.review.phase).toBe(current.phase);
      expect(result.review.requiredRoles).toEqual(current.roles);
      expect(result.unsigned).toBe(true);
    }
  });

  it("accepts canonical complete signatures and rejects partial or redirected transactions", () => {
    const input = {
      buyerShareSompi: MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI,
      mediatorParty: "buyer" as const,
      mode: "arbitrate" as const,
    };
    const signed = signedJson(input);
    const validated = validateMediatedEscrowSignatures({
      ...input,
      complete: true,
      row: signed.record,
      transactionSafeJson: signed.transactionSafeJson,
      utxo: signed.utxo,
    });
    expect(validated.filled).toEqual([true, true]);

    const partial = JSON.parse(signed.transactionSafeJson);
    partial.inputs[0].signatureScript =
      partial.inputs[0].signatureScript.slice(0, 132) +
      `41${"00".repeat(64)}01` +
      partial.inputs[0].signatureScript.slice(264);
    expect(() =>
      validateMediatedEscrowSignatures({
        ...input,
        complete: true,
        row: signed.record,
        transactionSafeJson: JSON.stringify(partial),
        utxo: signed.utxo,
      }),
    ).toThrow(/All required/);
    expect(
      validateMediatedEscrowSignatures({
        ...input,
        complete: false,
        row: signed.record,
        transactionSafeJson: JSON.stringify(partial),
        utxo: signed.utxo,
      }).filled,
    ).toEqual([true, false]);

    const redirected = JSON.parse(signed.transactionSafeJson);
    redirected.outputs[0].value = "1";
    expect(() =>
      validateMediatedEscrowSignatures({
        ...input,
        complete: true,
        row: signed.record,
        transactionSafeJson: JSON.stringify(redirected),
        utxo: signed.utxo,
      }),
    ).toThrow(/changed/);
  });

  it("selects one exact state output and validates public inputs", () => {
    const record = row();
    const exact = utxo(record, "active");
    expect(selectMediatedEscrowUtxo([], MEDIATED_ESCROW_FUNDING_SOMPI).state).toBe(
      "awaiting_funding",
    );
    expect(selectMediatedEscrowUtxo([exact], MEDIATED_ESCROW_FUNDING_SOMPI).state).toBe("funded");
    expect(
      selectMediatedEscrowUtxo([exact, { ...exact, index: 1 }], MEDIATED_ESCROW_FUNDING_SOMPI)
        .state,
    ).toBe("ambiguous");
    expect(
      mediatedEscrowCreateSchema.safeParse({
        claimDelayDaa: "6048000",
        mediatorLabel: "Independent mediator",
        sellerAddress: address(seller),
        sellerPublicKey: publicKey(seller),
        signerContextId: "escrow-context-1",
        title: "Physical item",
      }).success,
    ).toBe(true);
    expect(
      mediatedEscrowPublicActionSchema.safeParse({
        action: "saveSignature",
        buyerShareSompi: "20000000",
        mediatorParty: "buyer",
        mode: "arbitrate",
        role: "mediator",
        transactionSafeJson: "{}",
      }).success,
    ).toBe(true);
  });
});
