import { describe, expect, it } from "vitest";

import { kaspaStreamTransactionUrl } from "./kaspa-stream";

describe("kaspaStreamTransactionUrl", () => {
  it("builds the Kaspa.stream transaction detail URL", () => {
    const transactionId = "7F1B8567C86025CA85B4B4F422AE0266175F54C8E7DD0B804E3E2C7FB00C50EF";

    expect(kaspaStreamTransactionUrl(transactionId)).toBe(
      "https://kaspa.stream/transactions/7f1b8567c86025ca85b4b4f422ae0266175f54c8e7dd0b804e3e2c7fb00c50ef",
    );
  });

  it.each(["", "abc", "../transactions/example", "f".repeat(63), "f".repeat(65)])(
    "rejects an invalid transaction id: %s",
    (transactionId) => {
      expect(kaspaStreamTransactionUrl(transactionId)).toBeUndefined();
    },
  );
});
