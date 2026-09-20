import { ESCROW_V1_TEMPLATE_HEX } from "@kaspa-actions/kaspa/escrow-v1-artifact";
import type * as Kaspa from "kaspa-wasm";

import { withEscrowSignerSecret, type EscrowSignerContext } from "@/lib/escrow-passkey-signer";
import { loadPrototypeSdk } from "../prize-covenant/browser";

const AMOUNT = 100_000_000n;
const FEE = 20_000n;
const RELEASE_AFTER = 200_000_000n;
const COMPUTE_BUDGET = 2_000;
const FAKE_OUTPOINT = "ab".repeat(32);
const RELEASE_TAG = "8c7728a9";
const EMPTY_SIGNATURE = "00".repeat(64) + "01";
const SELLER_LAB_KEY = "22".repeat(32);

export type EscrowPasskeyDryRun = {
  amountSompi: string;
  broadcast: false;
  feeSompi: string;
  fundingAddress: string;
  intentVerified: true;
  publicKey: string;
  signatureScriptBytes: number;
  signedInBrowser: true;
  transactionId: string;
  transactionSafeJson: string;
};

type ScriptPublicKeyJson = { script: string; version: number };
type DryRunSdk = typeof Kaspa;

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

async function redeemScript(fields: string[]): Promise<string> {
  const paramsHash = await sha256Hex(fields.join(""));
  const stateHash = await sha256Hex("00" + paramsHash);
  if (!ESCROW_V1_TEMPLATE_HEX.startsWith("6b20")) throw new Error("Escrow artifact changed.");
  return ESCROW_V1_TEMPLATE_HEX.slice(0, 4) + stateHash + ESCROW_V1_TEMPLATE_HEX.slice(68);
}

function buildReleaseWitness(
  sdk: DryRunSdk,
  signature: string,
  fields: string[],
  sellerScriptPublicKey: string,
): string {
  const builder = new sdk.ScriptBuilder();
  for (const value of [signature, ...fields, sellerScriptPublicKey, RELEASE_TAG]) {
    builder.addData(value);
  }
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

export async function runEscrowPasskeyDryRun(
  prfOutput: Uint8Array,
  context: EscrowSignerContext,
  suppliedSdk?: DryRunSdk,
): Promise<EscrowPasskeyDryRun> {
  const sdk = suppliedSdk ?? (await loadPrototypeSdk());

  return withEscrowSignerSecret(prfOutput, context, async (secretKey) => {
    const buyerKey = new sdk.PrivateKey(bytesToHex(secretKey));
    const sellerKey = new sdk.PrivateKey(SELLER_LAB_KEY);
    try {
      const buyerPublicKey = buyerKey.toPublicKey().toXOnlyPublicKey().toString();
      const sellerPublicKey = sellerKey.toPublicKey().toXOnlyPublicKey().toString();
      const buyerScriptPublicKey = scriptPublicKeyHex(
        sdk
          .payToAddressScript(buyerKey.toAddress("mainnet").toString())
          .toJSON() as ScriptPublicKeyJson,
      );
      const sellerScriptJson = sdk
        .payToAddressScript(sellerKey.toAddress("mainnet").toString())
        .toJSON() as ScriptPublicKeyJson;
      const sellerScriptPublicKey = scriptPublicKeyHex(sellerScriptJson);
      const fields = await buildFields({
        buyerPublicKey,
        buyerScriptPublicKey,
        sellerPublicKey,
        sellerScriptPublicKey,
      });
      const script = await redeemScript(fields);
      const fundingScript = sdk.payToScriptHashScript(script);
      const fundingAddress = sdk.addressFromScriptPublicKey(fundingScript, "mainnet");
      if (!fundingAddress) throw new Error("Could not derive the dry-run funding address.");

      const emptyWitness = appendRedeemScript(
        buildReleaseWitness(sdk, EMPTY_SIGNATURE, fields, sellerScriptPublicKey),
        script,
      );
      const transaction = sdk.Transaction.deserializeFromSafeJSON(
        JSON.stringify({
          version: 1,
          id: "00".repeat(32),
          gas: "0",
          payload: "",
          subnetworkId: "00".repeat(20),
          lockTime: "0",
          inputs: [
            {
              transactionId: FAKE_OUTPOINT,
              index: 0,
              computeBudget: COMPUTE_BUDGET,
              sigOpCount: 0,
              sequence: "0",
              signatureScript: emptyWitness,
              utxo: {
                amount: (AMOUNT + FEE).toString(),
                blockDaaScore: "1000",
                isCoinbase: false,
                scriptPublicKey: fundingScript.toJSON(),
              },
            },
          ],
          outputs: [{ value: AMOUNT.toString(), scriptPublicKey: sellerScriptJson }],
        }),
      );
      transaction.finalize();
      const unsignedJson = transaction.serializeToSafeJSON();
      const signatureWithPush = sdk.createInputSignature(
        transaction,
        0,
        buyerKey,
        sdk.SighashType.All,
      );
      if (!/^41[0-9a-f]{128}01$/u.test(signatureWithPush)) {
        throw new Error("Kaspa WASM returned an invalid SIGHASH_ALL signature.");
      }
      const signature = signatureWithPush.slice(2);
      transaction.inputs[0]!.signatureScript = appendRedeemScript(
        buildReleaseWitness(sdk, signature, fields, sellerScriptPublicKey),
        script,
      );
      transaction.finalize();
      const signedJson = transaction.serializeToSafeJSON();
      if (canonicalIntent(unsignedJson) !== canonicalIntent(signedJson)) {
        throw new Error("Signing changed the reviewed escrow intent.");
      }

      return {
        amountSompi: AMOUNT.toString(),
        broadcast: false,
        feeSompi: FEE.toString(),
        fundingAddress: fundingAddress.toString(),
        intentVerified: true,
        publicKey: buyerPublicKey,
        signatureScriptBytes: transaction.inputs[0]!.signatureScript!.length / 2,
        signedInBrowser: true,
        transactionId: transaction.id,
        transactionSafeJson: signedJson,
      };
    } finally {
      buyerKey.free();
      sellerKey.free();
    }
  });
}
