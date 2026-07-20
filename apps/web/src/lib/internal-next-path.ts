const DEFAULT_NEXT_PATH = "/dashboard";

export function sanitizeInternalNextPath(value: null | string | undefined): string {
  const normalized = value?.trim() ?? "";
  const hasControlCharacter = Array.from(normalized).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

  if (
    normalized.length === 0 ||
    normalized.length > 256 ||
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    normalized.includes("\\") ||
    hasControlCharacter
  ) {
    return DEFAULT_NEXT_PATH;
  }

  return normalized;
}
