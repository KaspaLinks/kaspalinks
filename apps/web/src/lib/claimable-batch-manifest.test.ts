import { describe, expect, it } from "vitest";

import { parseStoredClaimableBatchOutputs } from "./claimable-batch-manifest";

describe("parseStoredClaimableBatchOutputs", () => {
  it("accepts canonical public output metadata", () => {
    const outputs = parseStoredClaimableBatchOutputs([
      { amountSompi: "100000000", linkKey: "batch-link-01", scriptPublicKeyHex: "0000aa" },
      { amountSompi: "200000000", linkKey: "batch-link-02", scriptPublicKeyHex: "0000bb" },
    ]);

    expect(outputs).toHaveLength(2);
    expect(outputs[0]?.amountSompi).toBe("100000000");
  });

  it("rejects private or malformed manifest shapes", () => {
    expect(() =>
      parseStoredClaimableBatchOutputs([
        {
          amountSompi: "100000000",
          claimCode: "must-never-be-stored",
          linkKey: "batch-link-01",
          scriptPublicKeyHex: "0000aa",
        },
        { amountSompi: "200000000", linkKey: "batch-link-02", scriptPublicKeyHex: "0000bb" },
      ]),
    ).toThrow("Stored batch output is invalid");
  });
});
