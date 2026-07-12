import { assertValidKaspaAddress } from "./address";
import { formatSompiToKaspa, parseKaspaAmountToSompi, parseSompiAmount } from "./amount";

export type BuildKaspaPaymentUriInput = {
  amountKas?: string;
  amountSompi?: bigint | number | string;
  label?: null | string;
  message?: null | string;
  recipientAddress: string;
};

/**
 * Build a `kaspa:` payment URI compatible with BIP-21-style wallets.
 *
 * Query parameters use **strict RFC 3986 percent-encoding** (spaces become
 * `%20`, not `+`). The default `URLSearchParams` encoder uses `+` for spaces,
 * while some mobile wallet deep-link parsers are stricter about URI query
 * encoding.
 */
export function buildKaspaPaymentUri(input: BuildKaspaPaymentUriInput): string {
  const { recipientAddress } = input;

  assertValidKaspaAddress(recipientAddress);

  if (input.amountKas !== undefined && input.amountSompi !== undefined) {
    throw new Error("Provide either amountKas or amountSompi, not both.");
  }

  const parts: string[] = [];
  const amountKas = getSafeAmountKas(input);

  if (amountKas) {
    parts.push(`amount=${encodeURIComponent(amountKas)}`);
  }

  appendOptionalTextParam(parts, "label", input.label);
  appendOptionalTextParam(parts, "message", input.message);

  return parts.length > 0 ? `${recipientAddress}?${parts.join("&")}` : recipientAddress;
}

function getSafeAmountKas(input: BuildKaspaPaymentUriInput): null | string {
  if (input.amountKas !== undefined) {
    return formatSompiToKaspa(parseKaspaAmountToSompi(input.amountKas));
  }

  if (input.amountSompi !== undefined) {
    return formatSompiToKaspa(parseSompiAmount(input.amountSompi));
  }

  return null;
}

function appendOptionalTextParam(parts: string[], key: string, value: null | string | undefined) {
  if (value === null || value === undefined) {
    return;
  }

  const trimmed = value.trim();

  if (trimmed.length > 0) {
    parts.push(`${key}=${encodeURIComponent(trimmed)}`);
  }
}
