import { validateKaspaAddress } from "./address";
import { buildKaspaPaymentUri, type BuildKaspaPaymentUriInput } from "./payment-uri";

export type BuildKaspaQrPayloadInput = BuildKaspaPaymentUriInput & {
  preferUri?: boolean;
};

export function buildKaspaQrPayload(input: BuildKaspaQrPayloadInput): string {
  const validation = validateKaspaAddress(input.recipientAddress);

  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  if (
    input.preferUri === false &&
    input.amountKas === undefined &&
    input.amountSompi === undefined
  ) {
    return input.recipientAddress;
  }

  return buildKaspaPaymentUri(input);
}
