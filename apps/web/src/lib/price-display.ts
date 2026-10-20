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

export function formatApproxUsdMeta(price: KasUsdPriceView | null): string {
  if (!price) return "Approx. USD value unavailable";
  const what = price.kasEur ? "value" : "USD value";
  return price.stale ? `Approx. ${what} from latest cached KAS price` : `Approx. ${what}`;
}
