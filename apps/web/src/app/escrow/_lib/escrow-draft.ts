import {
  MIN_RELIABLE_MAINNET_OUTPUT_KAS,
  MIN_RELIABLE_MAINNET_OUTPUT_SOMPI,
} from "@/lib/mainnet-amount-policy";

import { validateRecipientAddress } from "../../new-link/helpers";
import { computeEscrowAmounts, parseKasInput, type EscrowAmounts } from "./escrow-amounts";
import type {
  EscrowCondition,
  EscrowDepositRateBps,
  EscrowReleaseWindowDays,
} from "./escrow-types";

export const ESCROW_TITLE_MAX_LENGTH = 80;
export const ESCROW_DESCRIPTION_MAX_LENGTH = 600;

export const ESCROW_DEPOSIT_OPTIONS: ReadonlyArray<{
  bps: EscrowDepositRateBps;
  help: string;
  label: string;
}> = [
  {
    bps: 0,
    help: "Easiest to start. If you disagree, only the payment is frozen, so holding out costs nobody anything extra.",
    label: "No deposit",
  },
  {
    bps: 2500,
    help: "A light incentive to settle a disagreement quickly.",
    label: "25%",
  },
  {
    bps: 5000,
    help: "A solid incentive to agree without locking too much extra KAS.",
    label: "50%",
  },
  {
    bps: 10000,
    help: "Strongest incentive to agree: both sides lock as much as the deal is worth.",
    label: "100%",
  },
];

export const ESCROW_RELEASE_WINDOW_OPTIONS: ReadonlyArray<EscrowReleaseWindowDays> = [7, 14, 30];

export type EscrowDraftInput = {
  condition: "" | EscrowCondition;
  depositRateBps: EscrowDepositRateBps;
  description: string;
  payoutAddress: string;
  priceKas: string;
  releaseWindowDays: EscrowReleaseWindowDays;
  shippingKas: string;
  title: string;
};

export type EscrowDraftField =
  | "condition"
  | "description"
  | "payoutAddress"
  | "priceKas"
  | "shippingKas"
  | "title";

export type EscrowDraftValidation = {
  /** Present whenever price and shipping parse, so the preview can update before the form is complete. */
  amounts: EscrowAmounts | null;
  errors: Partial<Record<EscrowDraftField, string>>;
  ok: boolean;
};

export function validateEscrowDraft(input: EscrowDraftInput): EscrowDraftValidation {
  const errors: Partial<Record<EscrowDraftField, string>> = {};

  const title = input.title.trim();
  if (title.length === 0) {
    errors.title = "Give the item a title.";
  } else if (title.length > ESCROW_TITLE_MAX_LENGTH) {
    errors.title = `Keep the title under ${ESCROW_TITLE_MAX_LENGTH} characters.`;
  }

  if (input.condition === "") {
    errors.condition = "Choose the item condition.";
  }

  const description = input.description.trim();
  if (description.length === 0) {
    errors.description =
      "Describe the item. If you ever disagree, this description is what you both refer to.";
  } else if (description.length > ESCROW_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Keep the description under ${ESCROW_DESCRIPTION_MAX_LENGTH} characters.`;
  }

  const price = parseKasInput(input.priceKas, { allowZero: false });
  if (!price.ok) {
    errors.priceKas = price.message;
  } else if (price.sompi < MIN_RELIABLE_MAINNET_OUTPUT_SOMPI) {
    errors.priceKas = `The price must be at least ${MIN_RELIABLE_MAINNET_OUTPUT_KAS} KAS.`;
  }

  const shipping =
    input.shippingKas.trim().length === 0
      ? ({ ok: true, sompi: 0n } as const)
      : parseKasInput(input.shippingKas, { allowZero: true });
  if (!shipping.ok) {
    errors.shippingKas = shipping.message;
  }

  const address = validateRecipientAddress(input.payoutAddress);
  if (address.state === "empty") {
    errors.payoutAddress = "Paste the Kaspa address that should receive the payout.";
  } else if (address.state === "invalid") {
    errors.payoutAddress = address.reason;
  }

  const amounts =
    price.ok && shipping.ok
      ? computeEscrowAmounts({
          depositRateBps: input.depositRateBps,
          priceSompi: price.sompi,
          shippingSompi: shipping.sompi,
        })
      : null;

  return { amounts, errors, ok: Object.keys(errors).length === 0 };
}
