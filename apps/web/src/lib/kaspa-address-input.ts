// Kaspa addresses are lowercase. Phone keyboards like to capitalize the first
// letter ("Kaspa:…") or add a trailing space, which the Kaspa SDK rejects.

/** Input props for every field that takes a Kaspa address. */
export const KASPA_ADDRESS_INPUT_PROPS = {
  autoCapitalize: "none",
  autoComplete: "off",
  autoCorrect: "off",
  spellCheck: false,
} as const;

export function normalizeKaspaAddressInput(value: string): string {
  return value.trim().toLowerCase();
}

/** The Kaspa SDK throws plain strings; turn anything thrown into readable text. */
export function thrownMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}
