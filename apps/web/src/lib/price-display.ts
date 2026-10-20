import { normalizeLocalizedKasAmountInput } from "./amount-input";

export type KasUsdPriceView = {
  kasEur?: null | string;
  kasUsd: string;
  stale?: boolean;
};

const USD_FORMAT = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const SMALL_USD_FORMAT = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 3,
  minimumFractionDigits: 3,
  style: "currency",
});

const EUR_FORMAT = new Intl.NumberFormat("en-US", {
  currency: "EUR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const SMALL_EUR_FORMAT = new Intl.NumberFormat("en-US", {
  currency: "EUR",
  maximumFractionDigits: 3,
  minimumFractionDigits: 3,
  style: "currency",
});

export function formatApproxUsdValue(
  amountKas: null | string | undefined,
  price: KasUsdPriceView | null,
): null | string {
  if (!amountKas || !price) return null;

  const normalizedAmount = normalizeLocalizedKasAmountInput(amountKas.trim());
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(normalizedAmount)) return null;

  const amount = Number(normalizedAmount);
  const kasUsd = Number(price.kasUsd);
  if (!Number.isFinite(amount) || !Number.isFinite(kasUsd) || amount <= 0 || kasUsd <= 0) {
    return null;
  }

  const usdValue = amount * kasUsd;
  const usd = usdValue < 1 ? SMALL_USD_FORMAT.format(usdValue) : USD_FORMAT.format(usdValue);

  const kasEur = Number(price.kasEur ?? "");
  if (!Number.isFinite(kasEur) || kasEur <= 0) return `≈ ${usd} USD`;
  const eurValue = amount * kasEur;
  const eur = eurValue < 1 ? SMALL_EUR_FORMAT.format(eurValue) : EUR_FORMAT.format(eurValue);
  return `≈ ${usd} · ${eur}`;
}

/** Same as formatApproxUsdValue; the name says it covers USD and EUR. */
export const formatApproxFiatValue = formatApproxUsdValue;

export type AmountUnit = "EUR" | "KAS" | "USD";

const PLAIN_DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

function positiveRate(rate: null | string | undefined): null | number {
  const value = Number(rate ?? "");
  return Number.isFinite(value) && value > 0 ? value : null;
}

function positiveAmount(input: string): null | number {
  const normalized = normalizeLocalizedKasAmountInput(input.trim());
  if (!PLAIN_DECIMAL.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * KAS for a USD or EUR amount at the given KAS rate, rounded to 2 decimals
 * ("316.36", "300"). The link then holds this KAS amount; its fiat value moves
 * with the price afterwards.
 */
export function fiatToKas(fiatInput: string, kasRate: null | string | undefined): null | string {
  const fiat = positiveAmount(fiatInput);
  const rate = positiveRate(kasRate);
  if (fiat === null || rate === null) return null;
  const kas = Math.round((fiat / rate) * 100) / 100;
  if (!Number.isFinite(kas) || kas <= 0) return null;
  return kas.toFixed(2).replace(/\.?0+$/, "");
}

/** The USD or EUR amount for a KAS amount, as plain input text ("3.16"). */
export function kasToFiat(kasInput: string, kasRate: null | string | undefined): null | string {
  const kas = positiveAmount(kasInput);
  const rate = positiveRate(kasRate);
  if (kas === null || rate === null) return null;
  return (kas * rate).toFixed(2);
}

export function formatApproxUsdMeta(price: KasUsdPriceView | null): string {
  if (!price) return "Approx. USD value unavailable";
  const what = price.kasEur ? "value" : "USD value";
  return price.stale ? `Approx. ${what} from latest cached KAS price` : `Approx. ${what}`;
}
