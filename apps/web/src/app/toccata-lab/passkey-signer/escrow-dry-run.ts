import { ESCROW_V1_TEMPLATE_HEX } from "@kaspa-actions/kaspa/escrow-v1-artifact";
import type * as Kaspa from "kaspa-wasm";

import { withEscrowSignerSecret, type EscrowSignerContext } from "@/lib/escrow-passkey-signer";
import { loadPrototypeSdk } from "../prize-covenant/browser";

const AMOUNT = 100_000_000n;
const FEE = 20_000n;
const RELEASE_AFTER = 200_000_000n;
const SETTLEMENT_BUYER_SHARE = 40_000_000n;
const COMPUTE_BUDGET = 2_000;
const FAKE_OUTPOINT = "ab".repeat(32);
const EMPTY_SIGNATURE = "00".repeat(64) + "01";
const BUYER_LAB_KEY = "21".repeat(32);
const SELLER_LAB_KEY = "22".repeat(32);

const TAGS = {
  claim: "8fd20cef",
  freeze: "11456534",
  refund: "3198e8f6",
  release: "8c7728a9",
  settle: "a4fb823d",
} as const;

export type EscrowPasskeyDryRunPath =
  | "release"
  | "freeze"
  | "refund-active"
  | "refund-frozen"
  | "claim"
  | "settle";

export type EscrowPasskeyDryRunRole = "buyer" | "seller";

export type EscrowPasskeyDryRunSigner = {
  context: EscrowSignerContext;
  prfOutput: Uint8Array;
};

export type EscrowPasskeyDryRun = {
  amountSompi: string;
  broadcast: false;
  feeSompi: string;
  fundingAddress: string;
  intentVerified: true;
  mode: keyof typeof TAGS;
  outcome: string;
  path: EscrowPasskeyDryRunPath;
  phase: "active" | "frozen";
  publicKeys: Record<EscrowPasskeyDryRunRole, string>;
  signatureScriptBytes: number;
  signedInBrowser: true;
  signerPublicKeys: Partial<Record<EscrowPasskeyDryRunRole, string>>;
  signerRoles: EscrowPasskeyDryRunRole[];
  transactionId: string;
  transactionSafeJson: string;
};

type ScriptPublicKeyJson = { script: string; version: number };
type DryRunSdk = typeof Kaspa;
type DryRunPrivateKey = InstanceType<DryRunSdk["PrivateKey"]>;
type DryRunMode = keyof typeof TAGS;
type DryRunPhase = "active" | "frozen";

type PathConfiguration = {
  mode: DryRunMode;
  outcome: string;
  phase: DryRunPhase;
  signerRoles: EscrowPasskeyDryRunRole[];
};

const PATHS: Record<EscrowPasskeyDryRunPath, PathConfiguration> = {
  release: {
    mode: "release",
    outcome: "1 KAS to seller",
    phase: "active",
    signerRoles: ["buyer"],
  },
  freeze: {
    mode: "freeze",
    outcome: "1 KAS to frozen covenant",
    phase: "active",
    signerRoles: ["buyer"],
  },
  "refund-active": {
    mode: "refund",
    outcome: "1 KAS to buyer",
    phase: "active",
    signerRoles: ["seller"],
  },
  "refund-frozen": {
    mode: "refund",
    outcome: "0.9998 KAS to buyer",
    phase: "frozen",
    signerRoles: ["seller"],
  },
  claim: {
    mode: "claim",
    outcome: "1 KAS to seller after deadline",
    phase: "active",
    signerRoles: ["seller"],
  },
  settle: {
    mode: "settle",
    outcome: "0.4 KAS to buyer and 0.5998 KAS to seller",
    phase: "frozen",
    signerRoles: ["buyer", "seller"],
  },
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/u.test(hex)) throw new Error("Invalid dry-run hex.");
  return Uint8Array.from(hex.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

async function sha256Hex(hex: string): Promise<string> {
  const bytes = Uint8Array.from(hexToBytes(hex));
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function littleEndianU64(value: bigint): string {
  if (value <= 0n || value >= 1n << 55n) throw new Error("Invalid dry-run integer.");
  const bytes = new Uint8Array(8);
  let current = value;
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(current & 0xffn);
    current >>= 8n;
  }
  return bytesToHex(bytes);
}

function scriptPublicKeyHex(value: ScriptPublicKeyJson): string {
  if (value.version !== 0 || !/^[0-9a-f]+$/u.test(value.script)) {
    throw new Error("Expected a version-zero payout script.");
  }
  return "0000" + value.script;
}

async function buildFields(input: {
  buyerPublicKey: string;
  buyerScriptPublicKey: string;
  sellerPublicKey: string;
  sellerScriptPublicKey: string;
}): Promise<string[]> {
  return [
    littleEndianU64(AMOUNT),
    littleEndianU64(FEE),
    littleEndianU64(RELEASE_AFTER),
    input.buyerPublicKey,
    input.sellerPublicKey,
    await sha256Hex(input.buyerScriptPublicKey),
    await sha256Hex(input.sellerScriptPublicKey),
  ];
}

async function redeemScript(fields: string[], phase: DryRunPhase): Promise<string> {
  const paramsHash = await sha256Hex(fields.join(""));
  const stateHash = await sha256Hex((phase === "active" ? "00" : "01") + paramsHash);
  if (!ESCROW_V1_TEMPLATE_HEX.startsWith("6b20")) throw new Error("Escrow artifact changed.");
  return ESCROW_V1_TEMPLATE_HEX.slice(0, 4) + stateHash + ESCROW_V1_TEMPLATE_HEX.slice(68);
}

function buildWitness(
  sdk: DryRunSdk,
  signatures: string[],
  fields: string[],
  configuration: PathConfiguration,
  buyerScriptPublicKey: string,
  sellerScriptPublicKey: string,
): string {
  const values = [...signatures, ...fields];
  if (configuration.mode === "release" || configuration.mode === "claim") {
    values.push(sellerScriptPublicKey);
  }
  if (configuration.mode === "refund") {
    values.push(configuration.phase === "active" ? "00" : "01", buyerScriptPublicKey);
  }
  values.push(TAGS[configuration.mode]);

  const builder = new sdk.ScriptBuilder();
  for (const value of values) builder.addData(value);
  return builder.toString();
}

function appendRedeemScript(witnessHex: string, redeemScriptHex: string): string {
  const size = redeemScriptHex.length / 2;
  if (size <= 255 || size > 65_535) throw new Error("Unexpected escrow script size.");
  const sizeHex =
    (size & 0xff).toString(16).padStart(2, "0") +
    ((size >> 8) & 0xff).toString(16).padStart(2, "0");
  return witnessHex + "4d" + sizeHex + redeemScriptHex;
}

function canonicalIntent(safeJson: string): string {
  const value = JSON.parse(safeJson) as {
    id?: string;
    mass?: string;
    inputs: Array<{ signatureScript: string }>;
  };
  if (value.inputs.length !== 1) throw new Error("Expected one dry-run input.");
  delete value.id;
  delete value.mass;
  value.inputs[0]!.signatureScript = "";
  return JSON.stringify(value);
}

async function withRoleKey<T>(
  sdk: DryRunSdk,
  role: EscrowPasskeyDryRunRole,
  signer: EscrowPasskeyDryRunSigner | undefined,
  use: (key: DryRunPrivateKey) => Promise<T>,
): Promise<T> {
  if (signer) {
    if (signer.context.role !== role || signer.context.network !== "mainnet") {
      throw new Error(`Invalid ${role} signer context.`);
    }
    return withEscrowSignerSecret(signer.prfOutput, signer.context, async (secretKey) => {
      const key = new sdk.PrivateKey(bytesToHex(secretKey));
      try {
        return await use(key);
      } finally {
        key.free();
      }
    });
  }

  const key = new sdk.PrivateKey(role === "buyer" ? BUYER_LAB_KEY : SELLER_LAB_KEY);
  try {
    return await use(key);
  } finally {
    key.free();
  }
}

function buildOutputs(
  sdk: DryRunSdk,
  configuration: PathConfiguration,
  buyerScriptJson: ScriptPublicKeyJson,
  sellerScriptJson: ScriptPublicKeyJson,
  frozenScript: string,
): Array<{ value: string; scriptPublicKey: ScriptPublicKeyJson }> {
  switch (configuration.mode) {
    case "release":
    case "claim":
      return [{ value: AMOUNT.toString(), scriptPublicKey: sellerScriptJson }];
    case "refund":
      return [
        {
          value: (configuration.phase === "active" ? AMOUNT : AMOUNT - FEE).toString(),
          scriptPublicKey: buyerScriptJson,
        },
      ];
    case "freeze":
      return [
        {
          value: AMOUNT.toString(),
          scriptPublicKey: sdk.payToScriptHashScript(frozenScript).toJSON() as ScriptPublicKeyJson,
        },
      ];
    case "settle":
      return [
        { value: SETTLEMENT_BUYER_SHARE.toString(), scriptPublicKey: buyerScriptJson },
        {
          value: (AMOUNT - FEE - SETTLEMENT_BUYER_SHARE).toString(),
          scriptPublicKey: sellerScriptJson,
        },
      ];
  }
}

export async function runEscrowPasskeyDryRun(
  path: EscrowPasskeyDryRunPath,
  signers: Partial<Record<EscrowPasskeyDryRunRole, EscrowPasskeyDryRunSigner>>,
  suppliedSdk?: DryRunSdk,
): Promise<EscrowPasskeyDryRun> {
  const sdk = suppliedSdk ?? (await loadPrototypeSdk());
  const configuration = PATHS[path];
  for (const role of configuration.signerRoles) {
    if (!signers[role]) throw new Error(`The ${role} passkey is required for this dry run.`);
  }

  return withRoleKey(sdk, "buyer", signers.buyer, async (buyerKey) =>
    withRoleKey(sdk, "seller", signers.seller, async (sellerKey) => {
      const buyerPublicKey = buyerKey.toPublicKey().toXOnlyPublicKey().toString();
      const sellerPublicKey = sellerKey.toPublicKey().toXOnlyPublicKey().toString();
      const buyerScriptJson = sdk
        .payToAddressScript(buyerKey.toAddress("mainnet").toString())
        .toJSON() as ScriptPublicKeyJson;
      const sellerScriptJson = sdk
        .payToAddressScript(sellerKey.toAddress("mainnet").toString())
        .toJSON() as ScriptPublicKeyJson;
      const buyerScriptPublicKey = scriptPublicKeyHex(buyerScriptJson);
      const sellerScriptPublicKey = scriptPublicKeyHex(sellerScriptJson);
      const fields = await buildFields({
        buyerPublicKey,
        buyerScriptPublicKey,
        sellerPublicKey,
        sellerScriptPublicKey,
      });
      const script = await redeemScript(fields, configuration.phase);
      const frozenScript = await redeemScript(fields, "frozen");
      const fundingScript = sdk.payToScriptHashScript(script);
      const fundingAddress = sdk.addressFromScriptPublicKey(fundingScript, "mainnet");
      if (!fundingAddress) throw new Error("Could not derive the dry-run funding address.");

      const emptySignatures = configuration.signerRoles.map(() => EMPTY_SIGNATURE);
      const emptyWitness = appendRedeemScript(
        buildWitness(
          sdk,
          emptySignatures,
          fields,
          configuration,
          buyerScriptPublicKey,
          sellerScriptPublicKey,
        ),
        script,
      );
      const transaction = sdk.Transaction.deserializeFromSafeJSON(
        JSON.stringify({
          version: 1,
          id: "00".repeat(32),
          gas: "0",
          payload: "",
          subnetworkId: "00".repeat(20),
          lockTime: configuration.mode === "claim" ? RELEASE_AFTER.toString() : "0",
          inputs: [
            {
              transactionId: FAKE_OUTPOINT,
              index: 0,
              computeBudget: COMPUTE_BUDGET,
              sigOpCount: 0,
              sequence: "0",
              signatureScript: emptyWitness,
              utxo: {
                amount: (configuration.phase === "active" ? AMOUNT + FEE : AMOUNT).toString(),
                blockDaaScore: "1000",
                isCoinbase: false,
                scriptPublicKey: fundingScript.toJSON(),
              },
            },
          ],
          outputs: buildOutputs(
            sdk,
            configuration,
            buyerScriptJson,
            sellerScriptJson,
            frozenScript,
          ),
        }),
      );
      transaction.finalize();
      const unsignedJson = transaction.serializeToSafeJSON();
      const signatures = configuration.signerRoles.map((role) => {
        const key = role === "buyer" ? buyerKey : sellerKey;
        const signatureWithPush = sdk.createInputSignature(
          transaction,
          0,
          key,
          sdk.SighashType.All,
        );
        if (!/^41[0-9a-f]{128}01$/u.test(signatureWithPush)) {
          throw new Error("Kaspa WASM returned an invalid SIGHASH_ALL signature.");
        }
        return signatureWithPush.slice(2);
      });
      transaction.inputs[0]!.signatureScript = appendRedeemScript(
        buildWitness(
          sdk,
          signatures,
          fields,
          configuration,
          buyerScriptPublicKey,
          sellerScriptPublicKey,
        ),
        script,
      );
      transaction.finalize();
      const signedJson = transaction.serializeToSafeJSON();
      if (canonicalIntent(unsignedJson) !== canonicalIntent(signedJson)) {
        throw new Error("Signing changed the reviewed escrow intent.");
      }

      const publicKeys = { buyer: buyerPublicKey, seller: sellerPublicKey };
      return {
        amountSompi: AMOUNT.toString(),
        broadcast: false,
        feeSompi: FEE.toString(),
        fundingAddress: fundingAddress.toString(),
        intentVerified: true,
        mode: configuration.mode,
        outcome: configuration.outcome,
        path,
        phase: configuration.phase,
        publicKeys,
        signatureScriptBytes: transaction.inputs[0]!.signatureScript!.length / 2,
        signedInBrowser: true,
        signerPublicKeys: Object.fromEntries(
          configuration.signerRoles.map((role) => [role, publicKeys[role]]),
        ),
        signerRoles: configuration.signerRoles,
        transactionId: transaction.id,
        transactionSafeJson: signedJson,
      };
    }),
  );
}
