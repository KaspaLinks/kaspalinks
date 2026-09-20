import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import {
  buildEscrowV1Address,
  buildEscrowV1Transaction,
  type EscrowV1Parameters,
} from "@kaspa-actions/kaspa";
import {
  deriveEscrowSignerPublicIdentity,
  type EscrowSignerContext,
} from "@/lib/escrow-passkey-signer";
import {
  runEscrowPasskeyDryRun,
  type EscrowPasskeyDryRunPath,
  type EscrowPasskeyDryRunRole,
  type EscrowPasskeyDryRunSigner,
} from "./escrow-dry-run";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const contexts: Record<EscrowPasskeyDryRunRole, EscrowSignerContext> = {
  buyer: {
    escrowId: "passkey-lab-example",
    network: "mainnet",
    role: "buyer",
    signerVersion: 1,
  },
  seller: {
    escrowId: "passkey-lab-example",
    network: "mainnet",
    role: "seller",
    signerVersion: 1,
  },
};
const prfOutputs: Record<EscrowPasskeyDryRunRole, Uint8Array> = {
  buyer: new Uint8Array(32).fill(7),
  seller: new Uint8Array(32).fill(8),
};

const cases: Array<{
  lockTime: string;
  mode: "release" | "refund" | "claim" | "freeze" | "settle";
  outputValues: string[];
  path: EscrowPasskeyDryRunPath;
  phase: "active" | "frozen";
  roles: EscrowPasskeyDryRunRole[];
}> = [
  {
    lockTime: "0",
    mode: "release",
    outputValues: ["100000000"],
    path: "release",
    phase: "active",
    roles: ["buyer"],
  },
  {
    lockTime: "0",
    mode: "freeze",
    outputValues: ["100000000"],
    path: "freeze",
    phase: "active",
    roles: ["buyer"],
  },
  {
    lockTime: "0",
    mode: "refund",
    outputValues: ["100000000"],
    path: "refund-active",
    phase: "active",
    roles: ["seller"],
  },
  {
    lockTime: "0",
    mode: "refund",
    outputValues: ["99980000"],
    path: "refund-frozen",
    phase: "frozen",
    roles: ["seller"],
  },
  {
    lockTime: "200000000",
    mode: "claim",
    outputValues: ["100000000"],
    path: "claim",
    phase: "active",
    roles: ["seller"],
  },
  {
    lockTime: "0",
    mode: "settle",
    outputValues: ["40000000", "59980000"],
    path: "settle",
    phase: "frozen",
    roles: ["buyer", "seller"],
  },
];

function signersFor(roles: EscrowPasskeyDryRunRole[]) {
  return Object.fromEntries(
    roles.map((role) => [
      role,
      { context: contexts[role], prfOutput: prfOutputs[role] } satisfies EscrowPasskeyDryRunSigner,
    ]),
  );
}

function payoutScriptPublicKey(publicKey: string): string {
  const key = new sdk.PublicKey(publicKey);
  try {
    const json = sdk.payToAddressScript(key.toAddress("mainnet").toString()).toJSON() as {
      script: string;
      version: number;
    };
    return json.version.toString(16).padStart(4, "0") + json.script;
  } finally {
    key.free();
  }
}

function extractSignatures(signatureScript: string, count: number): string[] {
  const signatures: string[] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    expect(signatureScript.slice(offset, offset + 2)).toBe("41");
    signatures.push(signatureScript.slice(offset + 2, offset + 132));
    offset += 132;
  }
  return signatures;
}

describe("passkey escrow dry run", () => {
  for (const testCase of cases) {
    it(`builds and signs ${testCase.path} with the required passkey role`, async () => {
      const result = await runEscrowPasskeyDryRun(testCase.path, signersFor(testCase.roles), sdk);
      const transaction = JSON.parse(result.transactionSafeJson) as {
        inputs: Array<{ signatureScript: string; utxo: { amount: string } }>;
        lockTime: string;
        outputs: Array<{ value: string }>;
      };

      expect(result).toMatchObject({
        amountSompi: "100000000",
        broadcast: false,
        feeSompi: "20000",
        intentVerified: true,
        mode: testCase.mode,
        path: testCase.path,
        phase: testCase.phase,
        signedInBrowser: true,
        signerRoles: testCase.roles,
      });
      for (const role of testCase.roles) {
        const identity = await deriveEscrowSignerPublicIdentity(prfOutputs[role], contexts[role]);
        expect(result.signerPublicKeys[role]).toBe(identity.publicKey);
        expect(result.publicKeys[role]).toBe(identity.publicKey);
      }
      expect(result.fundingAddress).toMatch(/^kaspa:/u);
      expect(result.transactionId).toMatch(/^[0-9a-f]{64}$/u);
      expect(result.signatureScriptBytes).toBeGreaterThan(1_100);
      expect(transaction.inputs[0]!.signatureScript).not.toContain("00".repeat(64) + "01");
      expect(transaction.inputs[0]!.utxo.amount).toBe(
        testCase.phase === "active" ? "100020000" : "100000000",
      );
      expect(transaction.outputs.map((output) => output.value)).toEqual(testCase.outputValues);
      expect(transaction.lockTime).toBe(testCase.lockTime);
      expect(
        BigInt(transaction.inputs[0]!.utxo.amount) -
          transaction.outputs.reduce((sum, output) => sum + BigInt(output.value), 0n),
      ).toBe(20_000n);

      const parameters: EscrowV1Parameters = {
        amount: 100_000_000n,
        buyerPublicKey: result.publicKeys.buyer,
        buyerScriptPublicKey: payoutScriptPublicKey(result.publicKeys.buyer),
        fee: 20_000n,
        releaseAfter: 200_000_000n,
        sellerPublicKey: result.publicKeys.seller,
        sellerScriptPublicKey: payoutScriptPublicKey(result.publicKeys.seller),
      };
      const canonicalAddress = buildEscrowV1Address(parameters, testCase.phase);
      const canonical = buildEscrowV1Transaction(
        {
          computeBudget: 2_000,
          mode: testCase.mode,
          parameters,
          phase: testCase.phase,
          ...(testCase.mode === "settle" ? { buyerShare: 40_000_000n } : {}),
          utxo: {
            amount: transaction.inputs[0]!.utxo.amount,
            blockDaaScore: "1000",
            index: 0,
            scriptPublicKeyHex: canonicalAddress.scriptPublicKeyHex,
            transactionId: "ab".repeat(32),
          },
        },
        extractSignatures(transaction.inputs[0]!.signatureScript, testCase.roles.length),
      );
      expect(result.fundingAddress).toBe(canonicalAddress.address);
      expect(JSON.parse(canonical.transactionSafeJson).inputs[0].signatureScript).toBe(
        transaction.inputs[0]!.signatureScript,
      );
    });
  }

  it("requires every signer and rejects a role-swapped context", async () => {
    await expect(runEscrowPasskeyDryRun("release", {}, sdk)).rejects.toThrow(/buyer passkey/iu);
    await expect(
      runEscrowPasskeyDryRun(
        "release",
        { buyer: { context: contexts.seller, prfOutput: prfOutputs.buyer } },
        sdk,
      ),
    ).rejects.toThrow(/buyer signer context/iu);
    await expect(
      runEscrowPasskeyDryRun(
        "settle",
        { buyer: { context: contexts.buyer, prfOutput: prfOutputs.buyer } },
        sdk,
      ),
    ).rejects.toThrow(/seller passkey/iu);
  });
});
