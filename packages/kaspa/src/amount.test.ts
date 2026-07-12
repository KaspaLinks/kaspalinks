import { describe, expect, it } from "vitest";

import {
  formatSompiToKaspa,
  parseKaspaAmountToSompi,
  parseSompiAmount,
  SOMPI_PER_KAS,
} from "./amount";

describe("KAS and sompi conversion", () => {
  it("parses decimal KAS strings with BigInt arithmetic", () => {
    expect(parseKaspaAmountToSompi("1")).toBe(SOMPI_PER_KAS);
    expect(parseKaspaAmountToSompi("10")).toBe(1_000_000_000n);
    expect(parseKaspaAmountToSompi("0.00000001")).toBe(1n);
    expect(parseKaspaAmountToSompi("1.23456789")).toBe(123_456_789n);
  });

  it("formats positive sompi amounts into compact KAS strings", () => {
    expect(formatSompiToKaspa(1n)).toBe("0.00000001");
    expect(formatSompiToKaspa(100_000_000n)).toBe("1");
    expect(formatSompiToKaspa("123456789")).toBe("1.23456789");
  });

  it("rejects invalid KAS amounts", () => {
    for (const amount of [
      "",
      " 1",
      "1 ",
      "-1",
      "+1",
      "0",
      "0.00000000",
      "1.234567891",
      "1e3",
      "NaN",
      "Infinity",
    ]) {
      expect(() => parseKaspaAmountToSompi(amount)).toThrow();
    }
  });

  it("rejects invalid sompi amounts", () => {
    for (const amount of [0n, -1n, 1.5, Number.MAX_SAFE_INTEGER + 1, "01", "1.0", "1e3", " 1"]) {
      expect(() => parseSompiAmount(amount)).toThrow();
    }
  });
});
