const SOMPI_PER_KAS = 100_000_000n;

export const TOCCATA_CANARY_COMPUTE_BUDGET = 11;
export const TOCCATA_CANARY_SCRIPT_UNITS_USED = 100_293;
export const TOCCATA_CANARY_DEFAULT_FEE_SOMPI = 200_000n;
export const TOCCATA_CANARY_DAA_PER_SECOND_ESTIMATE = 10n;
export const TOCCATA_CANARY_MIN_FUNDING_SOMPI = 100_000_000n;
export const TOCCATA_CANARY_MIN_OUTPUT_SOMPI = 20_000_000n;
export const TOCCATA_CANARY_MAX_EXPIRY_SECONDS = 30n * 24n * 60n * 60n;

export type ToccataCanaryExpiryUnit = "days" | "hours" | "minutes";

export type ToccataCanarySpendPlan = {
  allowedScriptUnits: number;
  computeBudget: number;
  feeKas: string;
  feePercent: string;
  feeSompi: bigint;
  maxSafeFeeKas: string;
  maxSafeFeeSompi: bigint;
  meetsMinimumOutput: boolean;
  minimumOutputKas: string;
  minimumOutputSompi: bigint;
  netOutputKas: string;
  netOutputSompi: bigint;
  scriptUnitsHeadroom: number;
  scriptUnitsUsed: number;
  suggestedFundingKas: string;
  suggestedFundingSompi: bigint;
  utxoKas: string;
  utxoSompi: bigint;
};

export type ToccataCanaryExpiryPlan = {
  daaOffset: bigint;
  durationLabel: string;
  durationSeconds: bigint;
  refundLockTime: bigint;
};

export function calculateToccataCanaryAllowedScriptUnits(
  computeBudget = TOCCATA_CANARY_COMPUTE_BUDGET,
): number {
  return computeBudget * 10_000 + 9_999;
}

export function planToccataCanarySpendFromKas(input: {
  amountKas: string;
  feeKas?: string;
  feeSompi?: bigint | string;
}): ToccataCanarySpendPlan {
  const feeSompi =
    input.feeKas === undefined ? input.feeSompi : parseToccataCanaryFeeKasToSompi(input.feeKas);

  return planToccataCanarySpend({
    feeSompi,
    utxoSompi: parseToccataCanaryFundingKasToSompi(input.amountKas),
  });
}

export function planToccataCanarySpend(input: {
  feeSompi?: bigint | string;
  utxoSompi: bigint | string;
}): ToccataCanarySpendPlan {
  const utxoSompi = parsePositiveSompi(input.utxoSompi, "UTXO sompi");
  const feeSompi = parsePositiveSompi(
    input.feeSompi ?? TOCCATA_CANARY_DEFAULT_FEE_SOMPI,
    "Fee sompi",
  );

  if (feeSompi >= utxoSompi) {
    throw new Error("Fee must be lower than the funded amount.");
  }

  const netOutputSompi = utxoSompi - feeSompi;
  const maxSafeFeeSompi =
    utxoSompi > TOCCATA_CANARY_MIN_OUTPUT_SOMPI
      ? utxoSompi - TOCCATA_CANARY_MIN_OUTPUT_SOMPI
      : 0n;
  const allowedScriptUnits = calculateToccataCanaryAllowedScriptUnits();
  const scriptUnitsHeadroom = allowedScriptUnits - TOCCATA_CANARY_SCRIPT_UNITS_USED;

  return {
    allowedScriptUnits,
    computeBudget: TOCCATA_CANARY_COMPUTE_BUDGET,
    feeKas: formatSompiForToccataLab(feeSompi),
    feePercent: formatPercent(feeSompi, utxoSompi),
    feeSompi,
    maxSafeFeeKas: formatSompiForToccataLab(maxSafeFeeSompi),
    maxSafeFeeSompi,
    meetsMinimumOutput: netOutputSompi >= TOCCATA_CANARY_MIN_OUTPUT_SOMPI,
    minimumOutputKas: formatSompiForToccataLab(TOCCATA_CANARY_MIN_OUTPUT_SOMPI),
    minimumOutputSompi: TOCCATA_CANARY_MIN_OUTPUT_SOMPI,
    netOutputKas: formatSompiForToccataLab(netOutputSompi),
    netOutputSompi,
    scriptUnitsHeadroom,
    scriptUnitsUsed: TOCCATA_CANARY_SCRIPT_UNITS_USED,
    suggestedFundingKas: formatSompiForToccataLab(
      maxBigInt(TOCCATA_CANARY_MIN_FUNDING_SOMPI, TOCCATA_CANARY_MIN_OUTPUT_SOMPI + feeSompi),
    ),
    suggestedFundingSompi: maxBigInt(
      TOCCATA_CANARY_MIN_FUNDING_SOMPI,
      TOCCATA_CANARY_MIN_OUTPUT_SOMPI + feeSompi,
    ),
    utxoKas: formatSompiForToccataLab(utxoSompi),
    utxoSompi,
  };
}

export function planToccataCanaryExpiry(input: {
  currentDaaScore: bigint | string;
  durationValue: string;
  unit: ToccataCanaryExpiryUnit;
}): ToccataCanaryExpiryPlan {
  const currentDaaScore = parsePositiveSompi(input.currentDaaScore, "Current DAA score");
  const duration = parsePositiveSompi(input.durationValue, "Claim validity");
  const secondsPerUnit =
    input.unit === "days" ? 24n * 60n * 60n : input.unit === "hours" ? 60n * 60n : 60n;
  const durationSeconds = duration * secondsPerUnit;

  if (durationSeconds > TOCCATA_CANARY_MAX_EXPIRY_SECONDS) {
    throw new Error("Claim validity must be 30 days or less.");
  }

  const daaOffset = durationSeconds * TOCCATA_CANARY_DAA_PER_SECOND_ESTIMATE;
  const unitLabel = input.unit === "days" ? "day" : input.unit === "hours" ? "hour" : "minute";

  return {
    daaOffset,
    durationLabel: `${duration.toString()} ${unitLabel}${duration === 1n ? "" : "s"}`,
    durationSeconds,
    refundLockTime: currentDaaScore + daaOffset,
  };
}

export function parseToccataCanaryFundingKasToSompi(amountKas: string): bigint {
  const sompi = parseKasDecimalToSompi(amountKas, "Claim amount");

  if (sompi < TOCCATA_CANARY_MIN_FUNDING_SOMPI) {
    throw new Error("Claim amount must be at least 1 KAS.");
  }

  return sompi;
}

export function parseToccataCanaryFeeKasToSompi(feeKas: string): bigint {
  const sompi = parseKasDecimalToSompi(feeKas, "Claim/refund fee");
  if (sompi <= 0n) {
    throw new Error("Claim/refund fee must be greater than zero.");
  }
  return sompi;
}

export function formatSompiForToccataLab(sompi: bigint): string {
  const whole = sompi / SOMPI_PER_KAS;
  const fraction = sompi % SOMPI_PER_KAS;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(8, "0").replace(/0+$/, "")}`;
}

function parseKasDecimalToSompi(amountKas: string, label: string): bigint {
  const normalized = amountKas.trim().replace(",", ".");
  if (!/^[0-9]+(\.[0-9]+)?$/.test(normalized)) {
    throw new Error(`${label} must be a plain KAS number.`);
  }
  if (normalized.includes(".")) {
    const [, fraction = ""] = normalized.split(".");
    if (fraction.length > 8) {
      throw new Error(`${label} must not use more than 8 decimal places.`);
    }
  }

  const [wholeRaw = "0", fractionRaw = ""] = normalized.split(".");
  const wholeSompi = BigInt(wholeRaw) * SOMPI_PER_KAS;
  const fractionSompi = BigInt(fractionRaw.padEnd(8, "0") || "0");
  return wholeSompi + fractionSompi;
}

function parsePositiveSompi(value: bigint | string, label: string): bigint {
  if (typeof value === "bigint") {
    if (value <= 0n) throw new Error(`${label} must be greater than zero.`);
    return value;
  }

  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`${label} must be a whole number.`);
  }

  const parsed = BigInt(trimmed);
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function formatPercent(part: bigint, total: bigint): string {
  const basisPoints = (part * 10_000n) / total;
  const whole = basisPoints / 100n;
  const fraction = basisPoints % 100n;
  return `${whole}.${fraction.toString().padStart(2, "0")}%`;
}

function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
