import { createRequire } from "node:module";

type KaspaWasmModule = typeof import("kaspa-wasm");
type KaspaWasmAddress = InstanceType<KaspaWasmModule["Address"]>;

const ADDRESS_PREFIX_TO_NETWORK = {
  kaspa: "mainnet",
  kaspatest: "testnet",
} as const;

const require = createRequire(import.meta.url);
let cachedKaspaWasm: KaspaWasmModule | null = null;

type SupportedKaspaAddressPrefix = keyof typeof ADDRESS_PREFIX_TO_NETWORK;

export type KaspaNetwork = "mainnet" | "testnet";

export type KaspaAddressValidationResult =
  | {
      address: string;
      network: KaspaNetwork;
      valid: true;
    }
  | {
      reason: string;
      valid: false;
    };

export function validateKaspaAddress(address: string): KaspaAddressValidationResult {
  if (typeof address !== "string" || address.length === 0) {
    return { reason: "Address is required.", valid: false };
  }

  if (address.trim() !== address || /\s/.test(address)) {
    return { reason: "Address must not contain whitespace.", valid: false };
  }

  const { Address } = loadKaspaWasm();
  let parsed: KaspaWasmAddress;

  try {
    parsed = new Address(address);
  } catch {
    return { reason: "Address is not a valid Kaspa address.", valid: false };
  }

  try {
    const prefix = parsed.prefix;

    if (!isSupportedPrefix(prefix)) {
      return {
        reason: 'Address network must be "kaspa" or "kaspatest".',
        valid: false,
      };
    }

    return {
      address: parsed.toString(),
      network: ADDRESS_PREFIX_TO_NETWORK[prefix],
      valid: true,
    };
  } finally {
    parsed.free();
  }
}

export function assertValidKaspaAddress(address: string) {
  const result = validateKaspaAddress(address);

  if (!result.valid) {
    throw new Error(result.reason);
  }

  return result;
}

/** Converts a serialized public output script into its canonical Kaspa address. */
export function kaspaAddressFromScriptPublicKeyHex(
  scriptPublicKeyHex: string,
  network: "mainnet" | "testnet-10" = "mainnet",
): string {
  const normalized = scriptPublicKeyHex.toLowerCase();
  if (!/^[0-9a-f]+$/u.test(normalized) || normalized.length < 6 || normalized.length % 2 !== 0) {
    throw new Error("Script public key must be even-length hexadecimal with a version prefix.");
  }
  const version = Number.parseInt(normalized.slice(0, 4), 16);
  const { ScriptPublicKey, addressFromScriptPublicKey } = loadKaspaWasm();
  const scriptPublicKey = new ScriptPublicKey(version, normalized.slice(4));
  try {
    const address = addressFromScriptPublicKey(scriptPublicKey, network);
    if (!address) throw new Error("Script public key does not map to a Kaspa address.");
    try {
      return address.toString();
    } finally {
      address.free();
    }
  } finally {
    scriptPublicKey.free();
  }
}

function isSupportedPrefix(prefix: string): prefix is SupportedKaspaAddressPrefix {
  return prefix === "kaspa" || prefix === "kaspatest";
}

function loadKaspaWasm(): KaspaWasmModule {
  cachedKaspaWasm ??= require("kaspa-wasm") as KaspaWasmModule;
  return cachedKaspaWasm;
}
