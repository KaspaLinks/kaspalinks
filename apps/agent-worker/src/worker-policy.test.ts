import { describe, expect, it } from "vitest";

import { MAX_OUTBOX_ATTEMPTS, outboxDelayMs, shouldDeadLetterOutbox } from "./worker-policy.ts";

describe("Agent worker outbox policy", () => {
  it("backs off exponentially and caps retries at one hour", () => {
    expect(outboxDelayMs(1)).toBe(4_000);
    expect(outboxDelayMs(2)).toBe(8_000);
    expect(outboxDelayMs(20)).toBe(60 * 60_000);
  });

  it("dead-letters permanent failures and the final temporary attempt", () => {
    expect(shouldDeadLetterOutbox({ attempts: 1, permanent: true })).toBe(true);
    expect(shouldDeadLetterOutbox({ attempts: MAX_OUTBOX_ATTEMPTS - 1, permanent: false })).toBe(
      false,
    );
    expect(shouldDeadLetterOutbox({ attempts: MAX_OUTBOX_ATTEMPTS, permanent: false })).toBe(true);
  });
});
