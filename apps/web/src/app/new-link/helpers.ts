export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export type AddressValidation =
  | { state: "empty" }
  | { state: "valid" }
  | { reason: string; state: "invalid" };

// Permissive bech32-charset check (no full checksum verification - the
// server does the strict validation via kaspa-wasm). This is enough to
// catch common paste mistakes in the client before submit.
const BECH32_BODY_RE = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;

export function validateRecipientAddress(rawAddress: string): AddressValidation {
  const trimmed = rawAddress.trim();
  if (!trimmed) return { state: "empty" };

  if (trimmed.startsWith("kaspatest:")) {
    return {
      reason: "Kaspa Links is mainnet-only - paste a kaspa: address (not kaspatest:).",
      state: "invalid",
    };
  }

  if (!trimmed.startsWith("kaspa:")) {
    return {
      reason: "Address must start with kaspa:",
      state: "invalid",
    };
  }

  const body = trimmed.slice("kaspa:".length);

  if (body.length < 50 || body.length > 110) {
    return { reason: "Address body looks too short or too long.", state: "invalid" };
  }

  if (!BECH32_BODY_RE.test(body.toLowerCase())) {
    return {
      reason: "Address contains characters that aren't part of the Kaspa bech32 alphabet.",
      state: "invalid",
    };
  }

  return { state: "valid" };
}
