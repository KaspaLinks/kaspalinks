import { describe, expect, it } from "vitest";

import {
  assertToccataSdkReady,
  buildToccataBatchAllocatorLabScript,
  buildToccataClaimableLabScript,
  buildToccataClaimableLabSpend,
  createToccataPsktSmokePrototype,
  createToccataSafeJsonSmokePrototype,
  inspectToccataSdkCapabilities,
  TOCCATA_REQUIRED_CAPABILITIES,
} from "./toccata";

describe("Toccata SDK capabilities", () => {
  it("reports missing Toccata exports on an old or incomplete SDK", () => {
    const capabilities = inspectToccataSdkCapabilities({
      Transaction: class Transaction {},
      TransactionInput: class TransactionInput {},
      TransactionOutput: class TransactionOutput {},
      version: () => "0.13.0",
    });

    expect(capabilities.ready).toBe(false);
    expect(capabilities.version).toBe("0.13.0");
    expect(capabilities.missing).toContain("CovenantBinding");
    expect(capabilities.missing).toContain("PSKT");
  });

  it("accepts a Toccata-ready SDK surface", () => {
    const sdk = Object.fromEntries(
      TOCCATA_REQUIRED_CAPABILITIES.map((capability) => [capability, class CapabilityStub {}]),
    );
    const capabilities = inspectToccataSdkCapabilities({
      ...sdk,
      covenantId: () => "hash",
      payToScriptHashScript: () => "script",
      payToScriptHashSignatureScript: () => "signature-script",
      version: () => "2.0.1",
    });

    expect(capabilities).toEqual({
      missing: [],
      ready: true,
      version: "2.0.1",
    });
  });

  it("throws a clear error before covenant features are enabled on an incomplete SDK", () => {
    expect(() => assertToccataSdkReady({ version: () => "0.13.0" })).toThrow(
      /Kaspa Toccata SDK is missing/,
    );
  });

  it("loads the vendored rusty-kaspa v2.0.1 SDK as Toccata-ready", () => {
    const capabilities = assertToccataSdkReady();

    expect(capabilities.ready).toBe(true);
    expect(capabilities.missing).toEqual([]);
    expect(capabilities.version).toBe("2.0.1");
  });

  it("derives a deterministic claimable lab P2SH address from public keys", () => {
    const script = buildToccataClaimableLabScript({
      linkPublicKey: "bb14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72",
      refundLockTime: "123456789",
      refundPublicKey: "1730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8c",
    });

    expect(script).toMatchObject({
      fundingAddress: "kaspa:prclnra75kmgsm3hpt0cw692vg5p96udzfqnysjaywm8fw5v54et2jf8khjwf",
      network: "mainnet",
      redeemScriptHex:
        "6320bb14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72ac67b50415cd5b07a269201730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8cac68",
      refundLockTime: "123456789",
      scriptPublicKey: {
        script: "aa20f1f98fbea5b6886e370adf8768aa622812eb8d124132425d23b674ba8ca572b587",
        version: 0,
      },
    });
    expect(script.warning).toContain("Experimental lab script");
  });

  it("rejects malformed claimable lab public keys", () => {
    expect(() =>
      buildToccataClaimableLabScript({
        linkPublicKey: "not-a-key",
        refundLockTime: "123456789",
        refundPublicKey: "1730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8c",
      }),
    ).toThrow("linkPublicKey must be a 32-byte x-only public key hex string.");
  });

  it("commits each batch allocator recipient and amount in a deterministic P2SH script", () => {
    const base = {
      activationPublicKey: "bb14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72",
      refundLockTime: "123456789",
      refundPublicKey: "1730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8c",
    };
    const first = buildToccataBatchAllocatorLabScript({
      ...base,
      outputs: [
        { amountSompi: "100000000", scriptPublicKeyHex: "0000aa20" + "11".repeat(32) },
        { amountSompi: "100000000", scriptPublicKeyHex: "0000aa20" + "22".repeat(32) },
      ],
    });
    const changed = buildToccataBatchAllocatorLabScript({
      ...base,
      outputs: [
        { amountSompi: "100000000", scriptPublicKeyHex: "0000aa20" + "11".repeat(32) },
        { amountSompi: "100000001", scriptPublicKeyHex: "0000aa20" + "22".repeat(32) },
      ],
    });

    expect(first.outputCount).toBe(2);
    expect(first.redeemScriptHex).toContain("c2"); // OpTxOutputAmount
    expect(first.redeemScriptHex).toContain("c3"); // OpTxOutputSpk
    expect(first.fundingAddress).not.toBe(changed.fundingAddress);
    expect(() =>
      buildToccataBatchAllocatorLabScript({ ...base, outputs: [first.outputs[0]!] }),
    ).toThrow("between 2 and 10 committed outputs");
  });

  it("builds a signed claimable lab claim spend as SafeJSON", () => {
    const script = buildToccataClaimableLabScript({
      linkPublicKey: "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa",
      refundLockTime: "123456789",
      refundPublicKey: "466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27",
    });
    const spend = buildToccataClaimableLabSpend({
      destinationAddress: "kaspa:qrpuhc8c998cdp4fkgjljspuwtetvjhy022k0a00da4dxh3kkz89qa96gge5r",
      expectedFundingAddress: script.fundingAddress,
      feeSompi: "200000",
      fundingAmountSompi: "25000000",
      fundingOutputIndex: 0,
      fundingTransactionId:
        "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
      mode: "claim",
      privateKey: "1".repeat(64),
      redeemScriptHex: script.redeemScriptHex,
    });
    const transaction = JSON.parse(spend.transactionSafeJson) as {
      id: string;
      inputs: Array<{ computeBudget: number; signatureScript: string }>;
      outputs: Array<{ value: string }>;
    };

    expect(spend).toMatchObject({
      computeBudget: 11,
      feeSompi: "200000",
      fundingAddress: script.fundingAddress,
      mode: "claim",
      outputAmountSompi: "24800000",
    });
    expect(spend.transactionId).toMatch(/^[0-9a-f]{64}$/);
    expect(spend.signatureScriptHex).toContain(script.redeemScriptHex);
    expect(spend.signatureScriptHex.startsWith("41")).toBe(true);
    expect(spend.signatureScriptHex.startsWith("42")).toBe(false);
    expect(transaction.id).toBe(spend.transactionId);
    expect(transaction.inputs[0]?.computeBudget).toBe(11);
    expect(transaction.inputs[0]?.signatureScript).toBe(spend.signatureScriptHex);
    expect(transaction.outputs[0]?.value).toBe("24800000");
    expect(spend.warning).toContain("Experimental lab spend");
  });

  it("rejects claimable lab spends below the output floor", () => {
    const script = buildToccataClaimableLabScript({
      linkPublicKey: "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa",
      refundLockTime: "123456789",
      refundPublicKey: "466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27",
    });

    expect(() =>
      buildToccataClaimableLabSpend({
        destinationAddress: "kaspa:qrpuhc8c998cdp4fkgjljspuwtetvjhy022k0a00da4dxh3kkz89qa96gge5r",
        feeSompi: "200000",
        fundingAmountSompi: "20100000",
        fundingOutputIndex: 0,
        fundingTransactionId:
          "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
        mode: "claim",
        privateKey: "1".repeat(64),
        redeemScriptHex: script.redeemScriptHex,
      }),
    ).toThrow("Lab spend output must stay at or above the 0.2 KAS floor.");
  });

  it("creates a JSON-safe PSKT and covenant smoke prototype without signing or funding", () => {
    const prototype = createToccataPsktSmokePrototype();

    expect(prototype.sdk).toMatchObject({ ready: true, version: "2.0.1" });
    expect(prototype.network).toBe("mainnet");
    expect(prototype.safeToFund).toBe(false);
    expect(prototype.amountSompi).toBe("1000000");
    expect(prototype.script).toMatchObject({
      opcode: "OpFalse",
      p2shAddress: "kaspa:pqp3wz3wwktm0dlrmpxq2wgazwdx9v2hu7rcdkxqstefmn6vzyf3gnczph2ag",
      redeemScriptHex: "00",
    });
    expect(prototype.covenant.covenantId).toMatch(/^[0-9a-f]{64}$/);
    expect(prototype.covenant.output.hasCovenant).toBe(true);
    expect(prototype.pskt).toMatchObject({
      hasInputs: false,
      hasSignatures: false,
      outputCount: 1,
      role: "Constructor",
      txVersion: 0,
    });
    expect(prototype.pskt.serialized).toContain('"state":"Constructor"');
    expect(prototype.pskt.serialized.length).toBe(prototype.pskt.serializedLength);
    expect(prototype.pskt.serializedPreview.length).toBeLessThan(prototype.pskt.serialized.length);
    expect(prototype.steps.map((step) => step.name)).toEqual([
      "Script hash derivation",
      "Covenant binding",
      "Unsigned PSKT construction",
      "Covenant output in PSKT",
    ]);
    expect(prototype.steps.slice(0, 3).every((step) => step.status === "passed")).toBe(true);
    expect(prototype.steps[3]?.status).toBe("blocked");
    expect(JSON.stringify(prototype)).toContain("OP_FALSE");
  });

  it("creates a decode-only SafeJSON transaction prototype for wallet-format testing", () => {
    const prototype = createToccataSafeJsonSmokePrototype();

    expect(prototype.sdk).toMatchObject({ ready: true, version: "2.0.1" });
    expect(prototype.network).toBe("mainnet");
    expect(prototype.format).toBe("safe-json-transaction");
    expect(prototype.safeToFund).toBe(false);
    expect(prototype.walletSignable).toBe(false);
    expect(prototype.amountSompi).toBe("20000000");
    expect(prototype.script).toMatchObject({
      opcode: "OpFalse",
      p2shAddress: "kaspa:pqp3wz3wwktm0dlrmpxq2wgazwdx9v2hu7rcdkxqstefmn6vzyf3gnczph2ag",
      redeemScriptHex: "00",
    });
    expect(prototype.transaction).toMatchObject({
      hasInputs: false,
      hasSignatures: false,
      inputCount: 0,
      outputCount: 1,
      outputValueSompi: "20000000",
      txVersion: 0,
    });
    expect(prototype.transaction.id).toMatch(/^[0-9a-f]{64}$/);
    expect(prototype.transaction.scriptPublicKeyHex).toMatch(/^0000[0-9a-f]+$/);
    expect(prototype.transaction.safeJson).toContain('"outputs"');
    expect(prototype.transaction.safeJson).toContain('"value":"20000000"');
    expect(prototype.transaction.safeJson.length).toBe(prototype.transaction.safeJsonLength);
    expect(prototype.transaction.safeJsonPreview.length).toBeLessThan(
      prototype.transaction.safeJson.length,
    );
    expect(prototype.steps.map((step) => step.name)).toEqual([
      "Script hash derivation",
      "SafeJSON serialization",
      "SafeJSON round trip",
      "Covenant output in SafeJSON",
    ]);
    // The first three steps are deterministic; the covenant step reports the
    // SDK's actual SafeJSON covenant support and may be passed or blocked.
    expect(prototype.steps.slice(0, 3).every((step) => step.status === "passed")).toBe(true);
    expect(prototype.warnings.join(" ")).toContain("Transaction SafeJSON");
  });

  it("reports whether a covenant binding survives the SafeJSON round trip", () => {
    const prototype = createToccataSafeJsonSmokePrototype();
    const covenantStep = prototype.steps.find(
      (step) => step.name === "Covenant output in SafeJSON",
    );

    expect(covenantStep).toBeDefined();

    // The covenant result and the step status must tell the same story.
    expect(prototype.covenant.supported).toBe(covenantStep?.status === "passed");
    expect(prototype.covenant.supported).toBe(
      prototype.covenant.safeJsonIncludesBinding && prototype.covenant.roundTripPreserved,
    );

    if (prototype.covenant.supported) {
      // Full support: the binding is present with a real covenant id and
      // survives deserialize → serialize unchanged.
      expect(prototype.covenant.covenantId).toMatch(/^[0-9a-f]{64}$/);
    } else {
      // Partial or no support: the step detail must say what broke so the
      // lab UI surfaces an actionable message instead of a bare "blocked".
      expect(covenantStep?.detail.length ?? 0).toBeGreaterThan(20);
    }
  });
});
