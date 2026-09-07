import { z } from "zod";
import { planToccataCanaryClaimFromNetKas } from "@/lib/toccata-lab-fee";

// Only editable public terms belong here. Recovery and authentication stay in
// their existing stores; never serialize component state wholesale.
export const giveawaySetupSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(280),
  amountKas: z.string().trim().max(40),
  durationValue: z.string().max(8),
  durationUnit: z.enum(["minutes", "hours", "days"]),
  winnerClaimValue: z.string().max(8),
  winnerClaimUnit: z.enum(["minutes", "hours", "days"]),
  escrowPrize: z.boolean(),
  autoPrepareClaim: z.boolean(),
});
export type GiveawaySetup = z.infer<typeof giveawaySetupSchema>;

export function validateGiveawaySetup(input: GiveawaySetup) {
  const parsed = giveawaySetupSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? "Check your giveaway details.");
  const settings = parsed.data;
  if (!/^\d+(\.\d{1,8})?$/.test(settings.amountKas))
    throw new Error("Enter a KAS amount with at most 8 decimals.");
  const [whole, fraction = ""] = settings.amountKas.split(".");
  const sompi = BigInt(whole!) * 100000000n + BigInt(fraction.padEnd(8, "0"));
  if (sompi < 20000000n || sompi > 9223372036854775807n)
    throw new Error("The prize must be at least 0.2 KAS and within the supported amount range.");
  const plan = settings.escrowPrize
    ? planToccataCanaryClaimFromNetKas({ netAmountKas: settings.amountKas })
    : null;
  if (plan && plan.utxoSompi > 9223372036854775807n)
    throw new Error("Prize plus fee exceeds the supported amount range.");
  const duration = (value: string, unit: GiveawaySetup["durationUnit"]) => {
    if (!/^\d+$/.test(value)) throw new Error("Use a whole number for the duration.");
    const seconds = Number(value) * (unit === "days" ? 86400 : unit === "hours" ? 3600 : 60);
    if (seconds < 60 || seconds > 604800)
      throw new Error("Choose a duration between 1 minute and 7 days.");
    return seconds;
  };
  return {
    settings,
    plan,
    entryWindowSeconds: duration(settings.durationValue, settings.durationUnit),
    winnerClaimWindowSeconds: duration(settings.winnerClaimValue, settings.winnerClaimUnit),
  };
}

export function giveawayProgress(
  input: {
    status: string;
    closesAt: string;
    createdAt?: string;
    fundingExpiresAt?: string | null;
    prize: null | { status: string; funded: boolean };
    winnerClaim: { preparedTransactionId: string | null; expiresAt: string | null };
  },
  now: number,
) {
  if (input.prize?.status === "spent_unknown")
    return {
      label: "Prize needs verification",
      hint: "The prize was spent in an unrecognized transaction. Check the on-chain details.",
      step: "attention",
    };
  if (input.prize?.status === "refunded")
    return { label: "Refunded", hint: "The prize has been returned.", step: "complete" };
  if (input.prize?.status === "claimed")
    return { label: "Completed", hint: "The winner received the prize.", step: "complete" };
  if (input.status === "PENDING_FUNDING") {
    const expired = giveawayFundingDeadline(input) <= now;
    return {
      label: expired ? "Funding window closed" : "Finish setup",
      hint: expired
        ? "Do not send more funds. Check recovery options for any late payment."
        : "Save your recovery file and fund the prize to open entries.",
      step: expired ? "attention" : "fund",
    };
  }
  if (input.status === "CANCELLED" || input.status === "NO_ENTRIES")
    return {
      label: input.status === "CANCELLED" ? "Cancelled" : "No entries",
      hint: input.prize?.funded
        ? "Recover the prize when its refund lock expires."
        : "No winner payment is needed.",
      step: input.prize?.funded ? "refund" : "complete",
    };
  if (input.status === "DRAWN") {
    if (input.winnerClaim.expiresAt && new Date(input.winnerClaim.expiresAt).getTime() <= now)
      return {
        label: "Claim window closed",
        hint: "Recover any unclaimed prize when its refund lock expires.",
        step: "refund",
      };
    return input.winnerClaim.preparedTransactionId
      ? {
          label: "Waiting for winner",
          hint: "The payout is ready. The winner can claim it on the result page.",
          step: "claim",
        }
      : {
          label: "Prepare payout",
          hint: input.prize
            ? "Open this browser to sign the payout to the selected winner."
            : "Review the winner and pay from your wallet.",
          step: "payout",
        };
  }
  if (input.status === "CLOSED" || new Date(input.closesAt).getTime() <= now)
    return {
      label: "Drawing winner",
      hint: "Waiting for the confirmed Kaspa draw result.",
      step: "draw",
    };
  return {
    label: "Entries open",
    hint: "Share your giveaway to invite participants.",
    step: "open",
  };
}

export function giveawayFundingDeadline(input: {
  createdAt?: string;
  fundingExpiresAt?: string | null;
}) {
  const deadline = input.fundingExpiresAt
    ? Date.parse(input.fundingExpiresAt)
    : input.createdAt
      ? Date.parse(input.createdAt) + 3600000
      : 0;
  return Number.isFinite(deadline) ? deadline : 0;
}
