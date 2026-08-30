import { NotificationRuleKind } from "@kaspa-actions/db";
import { describe, expect, it } from "vitest";

import { notificationRuleMatches } from "./rules.ts";

const PAYMENT = { actionId: "action-1", amountSompi: 500_000_000n };

describe("notificationRuleMatches", () => {
  it.each([
    [NotificationRuleKind.ALL_PAYMENTS, null, null, true],
    [NotificationRuleKind.ACTION, "action-1", null, true],
    [NotificationRuleKind.ACTION, "action-2", null, false],
    [NotificationRuleKind.MINIMUM_AMOUNT, null, 500_000_000n, true],
    [NotificationRuleKind.MINIMUM_AMOUNT, null, 500_000_001n, false],
    [NotificationRuleKind.ACTION_MINIMUM_AMOUNT, "action-1", 400_000_000n, true],
    [NotificationRuleKind.ACTION_MINIMUM_AMOUNT, "action-2", 400_000_000n, false],
  ] as const)("matches %s rules", (kind, actionId, minimumSompi, expected) => {
    expect(notificationRuleMatches({ actionId, kind, minimumSompi }, PAYMENT)).toBe(expected);
  });
});
