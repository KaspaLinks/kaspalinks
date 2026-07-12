import { describe, expect, it } from "vitest";

import {
  decryptClaimableVaultValue,
  encryptClaimableVaultValue,
} from "./claimable-vault";

describe("claimable recovery vault", () => {
  it("round-trips Unicode recovery data without exposing plaintext", async () => {
    const value = {
      claimUrl: "https://kaspalinks.com/claim#gift=Grüße-🎁",
      refundCode: "a".repeat(64),
    };
    const envelope = await encryptClaimableVaultValue(
      value,
      "ka_creator_test-secret",
      "claimable-test",
    );

    expect(JSON.stringify(envelope)).not.toContain("refundCode");
    await expect(
      decryptClaimableVaultValue<typeof value>(
        envelope,
        "ka_creator_test-secret",
        "claimable-test",
      ),
    ).resolves.toEqual(value);
  });

  it("rejects a different creator token", async () => {
    const envelope = await encryptClaimableVaultValue(
      { manageUrl: "private" },
      "ka_creator_correct",
      "claimable-test",
    );

    await expect(
      decryptClaimableVaultValue(envelope, "ka_creator_wrong", "claimable-test"),
    ).rejects.toThrow();
  });
});
