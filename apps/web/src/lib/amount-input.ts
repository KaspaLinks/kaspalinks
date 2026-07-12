export function normalizeLocalizedKasAmountInput(value: string): string {
  return value.replace(/,/g, ".");
}
