/**
 * Compiled artifact for the giveaway prize covenant.
 *
 * Source: `labs/claimable-script/giveaway_prize_v5.sil`
 * Compiler: silverc v1.0.0 (kaspanet/silverscript commit 3ed9733)
 * Source sha256: 2630538139e369bc9a759f0a319aabc9c85371e63db6f24d8e656b1410277222
 *
 * The bytes below were produced by the compiler, not written by hand. Two
 * regions vary per deployment and per giveaway, and both are spliced in at
 * runtime rather than recompiled:
 *
 *   - the platform attestation key, which appears twice (the freeze and draw
 *     branches each call checkMsgSig)
 *   - the covenant state, a single 32-byte commitment
 *
 * Compiling with a different platform key changes exactly those two 32-byte
 * regions and nothing else; compiling with a different state changes only the
 * state span. Both facts are asserted by the tests, so a compiler or source
 * change that moves anything shows up as a failure rather than as a silently
 * wrong address.
 *
 * To regenerate: compile the source with the placeholder constructor
 * arguments below and replace the literal.
 */

import { createRequire } from "node:module";

type KaspaWasmModule = typeof import("kaspa-wasm");
let cachedKaspaWasm: KaspaWasmModule | undefined;

function loadKaspaWasm(): KaspaWasmModule {
  cachedKaspaWasm ??= createRequire(import.meta.url)("kaspa-wasm") as KaspaWasmModule;
  return cachedKaspaWasm;
}

/** Placeholder platform key in the template: 32 bytes of 0x11. */
const PLATFORM_KEY_PLACEHOLDER = "11".repeat(32);
/** Placeholder state in the template: 32 bytes of 0x33. */
const STATE_PLACEHOLDER = "33".repeat(32);

/** Byte offsets of the two platform-key copies. */
const PLATFORM_KEY_OFFSETS = [165, 431] as const;
/** Byte offset of the state commitment, just past its 0x20 push opcode. */
const STATE_OFFSET = 2;

export const GIVEAWAY_PRIZE_V5_SOURCE_SHA256 =
  "2630538139e369bc9a759f0a319aabc9c85371e63db6f24d8e656b1410277222";

export const GIVEAWAY_PRIZE_V5_DISPATCH_TAGS = {
  draw: "ad3ed6b0",
  freeze: "60140436",
  refund: "60d12c00",
} as const;

const GIVEAWAY_PRIZE_V5_TEMPLATE_HEX =
  "6b2033333333333333333333333333333333333333333333333333333333333333336c76046014043687637558798201409d75577982589d75567982589d75557982589d75547982589d755379825197009d7552798201209d75788201209d7557795779577957795779547954797e53797e52797e787ea8765779010052797e5a797ea887695c79ce7600a069767600050088526a74a569b06079011153797e5c797ea8201111111111111111111111111111111111111111111111111111111111111111d7695f79ce5f79ce7800a0697600a069b4519c6900c252795279939c69010154797e5d797ea80120787eb976c902200394765193bc7c7eb976c97602fe82937cbc7eaa02000001aa7e01207e7c7e01877e00c388757575757575757575757575757575757575757551677604ad3ed6b08763755a798201409d75597982589d75587982589d75577982589d75567982589d755579825197009d7554798201209d7553798201209d755279825197009d7578825197009d7559795979597959795979547954797e53797e52797e787ea8765779010152797e5d797ea88769011179011252797e5c797ea8201111111111111111111111111111111111111111111111111111111111111111d7695979827c75519600a0695979827c755196012097009c695979a85c7987695979827c7551960120965b79d40103787e5e797ea87600547f01007ece5379977600a2697654799f69760120955e797852790120937f5e79a88769011579ce7600a069b4519c6900c2789c6900c35f7987697575757575757575757575757575757575757575757575755167760460d12c00876375577982589d75567982589d75557982589d75547982589d755379825197009d75527982519d75788201209d7557795779577957795779547954797e53797e52797e787ea87657795a7952797e5a797ea887695b79ce5a790101875a7900a8879a635d79ce77687600a069767600050088526a74a569b05e79ceb9be7800a069765279a0695d79827c75519600a069b3519c69b4519c6900c2785379949c6900c35e79876975757575757575757575757575757575757551676a686868";

function requireHex32(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} must be 32-byte hex.`);
  return normalized;
}

function spliceAt(
  template: string,
  offset: number,
  expected: string,
  replacement: string,
  label: string,
): string {
  const start = offset * 2;
  const end = start + expected.length;
  if (template.slice(start, end) !== expected) {
    throw new Error(
      `The prize covenant template no longer holds the ${label} placeholder at byte ${offset}. ` +
        "Regenerate the artifact from giveaway_prize_v5.sil.",
    );
  }
  return template.slice(0, start) + replacement + template.slice(end);
}

/**
 * Build the redeem script for one giveaway prize covenant.
 *
 * `stateHashHex` is the covenant state, which encodes the phase, the giveaway
 * parameters and (once frozen) the entry list root. It determines the address,
 * so every giveaway and every phase has its own.
 */
export function buildGiveawayPrizeV5RedeemScriptHex(params: {
  platformPublicKeyHex: string;
  stateHashHex: string;
}): string {
  const platformKey = requireHex32(params.platformPublicKeyHex, "Platform public key");
  const stateHash = requireHex32(params.stateHashHex, "State hash");

  let script = GIVEAWAY_PRIZE_V5_TEMPLATE_HEX;
  for (const offset of PLATFORM_KEY_OFFSETS) {
    script = spliceAt(script, offset, PLATFORM_KEY_PLACEHOLDER, platformKey, "platform key");
  }
  script = spliceAt(script, STATE_OFFSET, STATE_PLACEHOLDER, stateHash, "state");

  if (script.length !== GIVEAWAY_PRIZE_V5_TEMPLATE_HEX.length) {
    throw new Error("Splicing changed the script length, which must never happen.");
  }
  return script;
}

/**
 * Mainnet address a prize covenant is funded to, and the pay-to-script-hash
 * output that address stands for.
 *
 * Every phase has its own address because the state is part of the script, so
 * moving from open to frozen moves the prize to a new address. That is what
 * makes each transition visible on-chain rather than only in the database.
 */
export function buildGiveawayPrizeV5Address(params: {
  platformPublicKeyHex: string;
  stateHashHex: string;
  wasmModule?: KaspaWasmModule;
}): { address: string; redeemScriptHex: string; scriptPublicKeyHex: string } {
  const wasmModule = params.wasmModule ?? loadKaspaWasm();
  const redeemScriptHex = buildGiveawayPrizeV5RedeemScriptHex(params);

  const scriptPublicKey = wasmModule.payToScriptHashScript(redeemScriptHex);
  const address = wasmModule.addressFromScriptPublicKey(scriptPublicKey, "mainnet");
  if (!address) {
    throw new Error("Could not derive the prize covenant P2SH address.");
  }

  const json = scriptPublicKey.toJSON() as { script: string; version: number };
  return {
    address: address.toString(),
    redeemScriptHex,
    scriptPublicKeyHex: `${json.version.toString(16).padStart(4, "0")}${json.script}`.toLowerCase(),
  };
}
