import type * as Kaspa from "kaspa-wasm";
type BrowserSdk = typeof Kaspa & { default(path: string): Promise<unknown> };
let loaded: Promise<BrowserSdk> | undefined;
export function loadPrototypeSdk(): Promise<BrowserSdk> {
  const url = "/vendor/kaspa-wasm-v2.0.1/web/kaspa/kaspa.js";
  loaded ??= import(/* webpackIgnore: true */ url).then(async (sdk: BrowserSdk) => {
    await sdk.default("/vendor/kaspa-wasm-v2.0.1/web/kaspa/kaspa_bg.wasm");
    return sdk;
  });
  return loaded;
}
export async function createPrototypeRecoveryKey() {
  const sdk = await loadPrototypeSdk();
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = new sdk.PrivateKey(
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
  );
  return {
    privateKeyHex: key.toString(),
    publicKeyHex: key.toPublicKey().toXOnlyPublicKey().toString(),
  };
}
export async function signPrototypeRefund(
  input: {
    transactionSafeJson: string;
    privateKeyHex: string;
    publicKeyHex: string;
    refundAddress: string;
  },
  wasmModule?: typeof Kaspa,
) {
  const sdk = wasmModule ?? (await loadPrototypeSdk());
  const key = new sdk.PrivateKey(input.privateKeyHex);
  if (key.toPublicKey().toXOnlyPublicKey().toString() !== input.publicKeyHex)
    throw new Error("Recovery file does not match this prototype.");
  const tx = sdk.Transaction.deserializeFromSafeJSON(input.transactionSafeJson);
  const parsed = JSON.parse(tx.serializeToSafeJSON());
  const expectedSpk = sdk.payToAddressScript(input.refundAddress);
  if (
    parsed.version !== 1 ||
    parsed.inputs.length !== 1 ||
    parsed.outputs.length !== 1 ||
    (typeof parsed.outputs[0].scriptPublicKey === "string"
      ? parsed.outputs[0].scriptPublicKey
      : `${parsed.outputs[0].scriptPublicKey.version === 0 ? "0000" : "invalid"}${parsed.outputs[0].scriptPublicKey.script}`) !==
      "0000" + expectedSpk.script ||
    BigInt(parsed.inputs[0].utxo.amount) - BigInt(parsed.outputs[0].value) !== 1_000_000n
  )
    throw new Error("Refund destination or fee differs from your intent.");
  const current = tx.inputs[0];
  if (!current || !current.signatureScript?.startsWith("41" + "00".repeat(65)))
    throw new Error("Invalid recovery witness.");
  const sig = sdk.createInputSignature(tx, 0, key, sdk.SighashType.All);
  current.signatureScript = sig + current.signatureScript.slice(132);
  tx.finalize();
  return tx.serializeToSafeJSON();
}

export async function verifyPrototypeRecoveryKey(
  privateKeyHex: string,
  publicKeyHex: string,
): Promise<void> {
  const sdk = await loadPrototypeSdk();
  try {
    const key = new sdk.PrivateKey(privateKeyHex);
    if (key.toPublicKey().toXOnlyPublicKey().toString() !== publicKeyHex) throw new Error();
  } catch {
    throw new Error("Recovery file does not match this prototype.");
  }
}
