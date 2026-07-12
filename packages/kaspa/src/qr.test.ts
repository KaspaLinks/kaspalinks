import { describe, expect, it } from "vitest";

import { buildKaspaQrPayload } from "./qr";

const RECIPIENT_ADDRESS = "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz";

describe("buildKaspaQrPayload", () => {
  it("uses a payment URI when amount metadata is available", () => {
    expect(
      buildKaspaQrPayload({
        amountKas: "2",
        message: "demo",
        recipientAddress: RECIPIENT_ADDRESS,
      }),
    ).toBe(`${RECIPIENT_ADDRESS}?amount=2&message=demo`);
  });

  it("can return only the address for address-only QR payloads", () => {
    expect(buildKaspaQrPayload({ preferUri: false, recipientAddress: RECIPIENT_ADDRESS })).toBe(
      RECIPIENT_ADDRESS,
    );
  });
});
