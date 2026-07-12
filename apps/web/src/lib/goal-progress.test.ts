import { describe, expect, it } from "vitest";

import { computeGoalProgress } from "./goal-progress";

const KAS = 100_000_000n;

describe("computeGoalProgress", () => {
  it("reports partial progress with one-decimal bar resolution", () => {
    const progress = computeGoalProgress({
      goalSompi: 1000n * KAS,
      raisedSompi: 4235n * KAS / 10n, // 423.5 KAS
      supporterCount: 17,
    });

    expect(progress.raisedKas).toBe("423.5");
    expect(progress.goalKas).toBe("1000");
    expect(progress.pct).toBe(42.3);
    expect(progress.pctLabel).toBe(42);
    expect(progress.reached).toBe(false);
    expect(progress.supporterCount).toBe(17);
  });

  it("marks the goal reached at exactly 100%", () => {
    const progress = computeGoalProgress({
      goalSompi: 1000n * KAS,
      raisedSompi: 1000n * KAS,
      supporterCount: 4,
    });

    expect(progress.pct).toBe(100);
    expect(progress.pctLabel).toBe(100);
    expect(progress.reached).toBe(true);
  });

  it("caps the bar at 100 but keeps the true label when overfunded", () => {
    const progress = computeGoalProgress({
      goalSompi: 1000n * KAS,
      raisedSompi: 1500n * KAS,
      supporterCount: 9,
    });

    expect(progress.pct).toBe(100);
    expect(progress.pctLabel).toBe(150);
    expect(progress.reached).toBe(true);
  });

  it("formats a freshly created, zero-raised goal without throwing", () => {
    const progress = computeGoalProgress({
      goalSompi: 500n * KAS,
      raisedSompi: 0n,
      supporterCount: 0,
    });

    expect(progress.raisedKas).toBe("0");
    expect(progress.pct).toBe(0);
    expect(progress.pctLabel).toBe(0);
    expect(progress.reached).toBe(false);
  });

  it("defends against a malformed zero goal instead of dividing by zero", () => {
    const progress = computeGoalProgress({
      goalSompi: 0n,
      raisedSompi: 50n * KAS,
      supporterCount: 1,
    });

    expect(progress.goalKas).toBe("0");
    expect(progress.pct).toBe(100);
    expect(progress.reached).toBe(true);
  });

  it("clamps negative input to zero", () => {
    const progress = computeGoalProgress({
      goalSompi: 100n * KAS,
      raisedSompi: -5n * KAS,
      supporterCount: -3,
    });

    expect(progress.raisedKas).toBe("0");
    expect(progress.pct).toBe(0);
    expect(progress.supporterCount).toBe(0);
  });
});
