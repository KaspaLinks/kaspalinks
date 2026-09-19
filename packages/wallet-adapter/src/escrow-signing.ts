import type { KaswareProvider } from "./index";
/** Offline transport only. Caller must verify the resulting covenant signature and finalize the reconstructed
 * transaction with the SDK before relay. Returned derived id/mass fields are not authoritative.
 * No key material, funding call, persistence, or broadcast occurs here.
 */
export async function requestEscrowWalletSignature(
  provider: KaswareProvider,
  input: { transactionSafeJson: string; signatureSlot: 0 | 1; signatureCount: 1 | 2 },
): Promise<string> {
  const method = provider.signPskt ?? provider.signPSKT;
  if (typeof method !== "function") throw new Error("Wallet does not expose transaction signing.");
  const tx = parse(input.transactionSafeJson);
  if (
    tx.version !== 1 ||
    tx.inputs.length !== 1 ||
    ![0, 1].includes(input.signatureSlot) ||
    ![1, 2].includes(input.signatureCount) ||
    input.signatureSlot >= input.signatureCount
  )
    throw new Error("Invalid escrow signing request.");
  const original = tx.inputs[0].signatureScript;
  const offset = input.signatureSlot * 132;
  for (let i = 0; i < input.signatureCount; i++)
    if (!/^41[0-9a-f]{128}01$/.test(original.slice(i * 132, (i + 1) * 132)))
      throw new Error("Unsupported escrow signature template.");
  // A selected slot must still be empty. Never silently replace a previous signer.
  if (original.slice(offset + 2, offset + 130) !== "00".repeat(64))
    throw new Error("Escrow signature slot is already occupied.");
  const raw = await method.call(provider, {
    txJsonString: input.transactionSafeJson,
    options: { signInputs: [{ index: 0, sighashType: 1 }] },
  });
  if (typeof raw !== "string")
    throw new Error("Unsupported wallet response. Escrow signing remains unavailable.");
  const returned = parse(raw);
  if (intent(tx) !== intent(returned))
    throw new Error("Wallet changed the reviewed escrow transaction.");
  const script = returned.inputs[0].signatureScript;
  // Only accept a bare standard signature, or our exact template with this one slot changed.
  const fullTemplate =
    script.length === original.length &&
    script.slice(0, offset) === original.slice(0, offset) &&
    script.slice(offset + 132) === original.slice(offset + 132);
  const candidate = fullTemplate ? script.slice(offset, offset + 132) : script;
  if (!/^41[0-9a-f]{128}01$/.test(candidate) || candidate.slice(2, 130) === "00".repeat(64))
    throw new Error("Wallet did not return a supported SIGHASH_ALL signature.");
  // Keep all other signatures and covenant bytes from the reviewed intent.
  tx.inputs[0].signatureScript =
    original.slice(0, offset) + candidate + original.slice(offset + 132);
  return JSON.stringify(tx);
}
type Tx = {
  version: number;
  inputs: [{ signatureScript: string; [key: string]: unknown }];
  [key: string]: unknown;
};
function parse(value: string): Tx {
  if (value.length > 100000) throw new Error("Escrow transaction too large.");
  const t = JSON.parse(value);
  if (
    !t ||
    !Array.isArray(t.inputs) ||
    t.inputs.length !== 1 ||
    !Array.isArray(t.outputs) ||
    typeof t.inputs[0]?.signatureScript !== "string"
  )
    throw new Error("Invalid escrow transaction.");
  return t;
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, ordered(v)]),
    );
  return value;
}
function intent(tx: Tx): string {
  const copy = JSON.parse(JSON.stringify(tx));
  delete copy.id;
  delete copy.mass;
  copy.inputs[0].signatureScript = "";
  return JSON.stringify(ordered(copy));
}
