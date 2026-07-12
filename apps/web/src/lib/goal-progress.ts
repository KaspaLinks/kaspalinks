import { PaymentRequestStatus, type PrismaClient } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

/**
 * Read-model for the crowdfunding progress bar on goal links (Action
 * type KASPA_GOAL).
 *
 * Always computed server-side: the formatting helper drags the kaspa
 * runtime in, and — more importantly — the percentage math has to stay
 * in integer-sompi BigInt land. Calling Number() on a raw sompi amount
 * overflows the 53-bit safe-integer range and silently loses precision
 * on large balances (a hard AGENTS.md no-go). Clients receive only the
 * finished primitives via `import type { GoalProgress }`, so this
 * module never reaches the browser bundle.
 */
export type GoalProgress = {
  /** Fundraising target, formatted KAS string (e.g. "1000"). */
  goalKas: string;
  /** Bar fill, clamped to 0–100 with one-decimal resolution. */
  pct: number;
  /** Actual percentage rounded to a whole number; may exceed 100. */
  pctLabel: number;
  /** Confirmed total raised, formatted KAS string (e.g. "423.5"). */
  raisedKas: string;
  /** True once the confirmed total meets or beats the goal. */
  reached: boolean;
  /** Confirmed payments counted toward this goal. */
  supporterCount: number;
};

// formatSompiToKaspa throws on a non-positive amount (it shares the
// strict parseSompiAmount guard), but a freshly created goal legitimately
// sits at 0 raised — so the zero case is formatted by hand.
function formatSompiSafe(sompi: bigint): string {
  return sompi <= 0n ? "0" : formatSompiToKaspa(sompi);
}

export function computeGoalProgress(input: {
  goalSompi: bigint;
  raisedSompi: bigint;
  supporterCount: number;
}): GoalProgress {
  const raised = input.raisedSompi < 0n ? 0n : input.raisedSompi;
  const goal = input.goalSompi;
  const supporterCount = input.supporterCount < 0 ? 0 : input.supporterCount;

  // Defensive zero/negative-goal guard. The schema requires goalSompi > 0,
  // so this only fires for a malformed legacy row — but it keeps the bar
  // from dividing by zero.
  if (goal <= 0n) {
    return {
      goalKas: "0",
      pct: raised > 0n ? 100 : 0,
      pctLabel: raised > 0n ? 100 : 0,
      raisedKas: formatSompiSafe(raised),
      reached: raised > 0n,
      supporterCount,
    };
  }

  // Percentage stays in integer-sompi space: multiply before dividing to
  // keep precision, scaled by 1000 for one-decimal resolution. The final
  // Number() only ever touches the small ratio (≈ raised/goal × 1000),
  // never a raw sompi amount, so there is no 53-bit overflow risk.
  const scaled = (raised * 1000n) / goal;
  const pctRaw = Number(scaled) / 10;
  const pct = Math.max(0, Math.min(100, Math.round(pctRaw * 10) / 10));
  const pctLabel = Math.round(pctRaw);

  return {
    goalKas: formatSompiSafe(goal),
    pct,
    pctLabel,
    raisedKas: formatSompiSafe(raised),
    reached: raised >= goal,
    supporterCount,
  };
}

/**
 * Sum every confirmed PaymentRequest for a goal Action and fold it into a
 * GoalProgress. Returns null for non-goal Actions (goalSompi === null) so
 * callers can render the bar unconditionally with `progress && <Bar/>`.
 *
 * One aggregate query per goal Action. Profiles only carry a handful of
 * goals, so the per-card cost is negligible; if a creator ever stacks
 * dozens this can move to a single groupBy.
 */
export async function loadGoalProgress(
  prisma: PrismaClient,
  action: { goalSompi: bigint | null; id: string },
): Promise<GoalProgress | null> {
  if (action.goalSompi === null) {
    return null;
  }

  const aggregate = await prisma.paymentRequest.aggregate({
    _count: { _all: true },
    _sum: { amountSompi: true },
    where: { actionId: action.id, status: PaymentRequestStatus.CONFIRMED },
  });

  return computeGoalProgress({
    goalSompi: action.goalSompi,
    raisedSompi: aggregate._sum.amountSompi ?? 0n,
    supporterCount: aggregate._count._all,
  });
}
