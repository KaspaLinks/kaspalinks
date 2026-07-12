export const SOMPI_PER_KAS = 100_000_000n;
const MAX_DECIMAL_PLACES = 8;

export function parseKaspaAmountToSompi(amountKas: string): bigint {
  if (typeof amountKas !== "string") {
    throw new Error("KAS amount must be a string.");
  }

  const trimmed = amountKas.trim();

  if (trimmed.length === 0) {
    throw new Error("KAS amount is required.");
  }

  if (trimmed !== amountKas) {
    throw new Error("KAS amount must not include surrounding whitespace.");
  }

  if (trimmed.startsWith("-")) {
    throw new Error("KAS amount must not be negative.");
  }

  if (/^[+]/.test(trimmed) || /e/i.test(trimmed) || trimmed === "NaN" || trimmed === "Infinity") {
    throw new Error("KAS amount must be a plain decimal string.");
  }

  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    throw new Error("KAS amount must be numeric.");
  }

  const [wholePart = "0", decimalPart = ""] = trimmed.split(".");

  if (decimalPart.length > MAX_DECIMAL_PLACES) {
    throw new Error("KAS amount must not have more than 8 decimal places.");
  }

  const paddedDecimalPart = decimalPart.padEnd(MAX_DECIMAL_PLACES, "0");
  const sompi = BigInt(wholePart) * SOMPI_PER_KAS + BigInt(paddedDecimalPart || "0");

  if (sompi <= 0n) {
    throw new Error("KAS amount must be greater than zero.");
  }

  return sompi;
}

export function parseSompiAmount(amountSompi: bigint | number | string): bigint {
  const sompi =
    typeof amountSompi === "bigint"
      ? amountSompi
      : typeof amountSompi === "number"
        ? parseNumberSompi(amountSompi)
        : parseStringSompi(amountSompi);

  if (sompi <= 0n) {
    throw new Error("Sompi amount must be greater than zero.");
  }

  return sompi;
}

export function formatSompiToKaspa(amountSompi: bigint | number | string): string {
  const sompi = parseSompiAmount(amountSompi);
  const wholePart = sompi / SOMPI_PER_KAS;
  const decimalPart = sompi % SOMPI_PER_KAS;

  if (decimalPart === 0n) {
    return wholePart.toString();
  }

  return `${wholePart}.${decimalPart.toString().padStart(MAX_DECIMAL_PLACES, "0").replace(/0+$/, "")}`;
}

function parseNumberSompi(amountSompi: number): bigint {
  if (!Number.isSafeInteger(amountSompi)) {
    throw new Error("Sompi amount number must be a safe integer.");
  }

  return BigInt(amountSompi);
}

function parseStringSompi(amountSompi: string): bigint {
  if (amountSompi.trim() !== amountSompi || !/^(?:0|[1-9]\d*)$/.test(amountSompi)) {
    throw new Error("Sompi amount must be an integer string.");
  }

  return BigInt(amountSompi);
}
