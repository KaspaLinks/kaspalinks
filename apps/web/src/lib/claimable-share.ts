const PRIVATE_KEY_HEX = /^[0-9a-f]{64}$/i;
const BASE64_URL = /^[A-Za-z0-9_-]{43}$/;

export const CLAIMABLE_SOCIAL_PREVIEW_VERSION = "5";
export const CLAIMABLE_COMPACT_HASH_PREFIX = "c=";

export function withClaimablePreviewVersion(value: string): string {
  const url = new URL(value);
  url.searchParams.set("preview", CLAIMABLE_SOCIAL_PREVIEW_VERSION);
  return url.toString();
}

export function encodeClaimCodeForSharing(privateKeyHex: string): string {
  const normalized = privateKeyHex.trim().toLowerCase();
  if (!PRIVATE_KEY_HEX.test(normalized)) {
    throw new Error("Claim code must be a 32-byte private key.");
  }

  const bytes = normalized.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? [];
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeSharedClaimCode(value: string): string {
  const normalized = value.trim().replace(/^claim code:\s*/i, "");
  if (PRIVATE_KEY_HEX.test(normalized)) return normalized.toLowerCase();
  if (!BASE64_URL.test(normalized)) {
    throw new Error("Enter the 43-character claim code shown with the shared link.");
  }

  try {
    const base64 = normalized.replaceAll("-", "+").replaceAll("_", "/").padEnd(44, "=");
    const binary = atob(base64);
    if (binary.length !== 32) throw new Error("invalid length");
    return Array.from(binary, (character) =>
      character.charCodeAt(0).toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    throw new Error("Claim code is invalid.");
  }
}

export function buildClaimableXPostText(input: {
  netClaimKas: string;
  title: string;
}): string {
  return [
    input.title.trim() || "Kaspa to claim",
    `First come, first served: claim ${input.netClaimKas} KAS.`,
    "",
    "Non-custodial. Open the link and claim directly to your own wallet.",
  ].join("\n");
}

export function buildCompactClaimUrl(value: string, privateKeyHex?: string): string {
  const url = new URL(withClaimablePreviewVersion(value));
  const claimCode = privateKeyHex ?? extractClaimCodeFromClaimUrl(url.toString());
  url.hash = `${CLAIMABLE_COMPACT_HASH_PREFIX}${encodeClaimCodeForSharing(claimCode)}`;
  return url.toString();
}

export function extractClaimCodeFromClaimUrl(value: string): string {
  try {
    const url = new URL(value);
    const compactPrefix = `#${CLAIMABLE_COMPACT_HASH_PREFIX}`;
    if (url.hash.startsWith(compactPrefix)) {
      return decodeSharedClaimCode(url.hash.slice(compactPrefix.length));
    }

    const prefix = "#lab-claim=";
    if (!url.hash.startsWith(prefix)) throw new Error("missing fragment");
    const encoded = url.hash.slice(prefix.length);
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const payload = JSON.parse(
      atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")),
    ) as {
      claimCode?: unknown;
    };
    if (typeof payload.claimCode !== "string" || !PRIVATE_KEY_HEX.test(payload.claimCode)) {
      throw new Error("missing claim code");
    }
    return payload.claimCode.toLowerCase();
  } catch {
    throw new Error("The private claim code is not available in this browser.");
  }
}
