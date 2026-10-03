import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseClaimableRegistration } from "./claimable-registration";
import { createToccataClaimableAutoReturnScript } from "./toccata-lab";

const CLAIM_PUBLIC_KEY = "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa";
const REFUND_PUBLIC_KEY = "466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27";
const RETURN_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const V1_ADDRESS = "kaspa:ppkr0dzfr3ptks6w0238uzqrqr98h07a3rrplzlwdmau3hapzjma6qe42a2vh";
const V1_SCRIPT =
  "63204f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aaac67b5040065cd1da26920466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27ac68";

const v2Script = createToccataClaimableAutoReturnScript({
  feeSompi: "200000",
  linkPublicKey: CLAIM_PUBLIC_KEY,
  refundLockTime: "500000000",
  returnAddress: RETURN_ADDRESS,
});

const v2Body = {
  amountSompi: "100200000",
  claimPublicKey: CLAIM_PUBLIC_KEY,
  feeSompi: "200000",
  fundingAddress: v2Script.fundingAddress,
  linkKey: "lab-abc123",
  redeemScriptHex: v2Script.redeemScriptHex,
  refundLockTime: "500000000",
  returnAddress: RETURN_ADDRESS,
  scriptVersion: 2,
  title: "Coffee for Ada",
};

const v1Body = {
  amountSompi: "100000000",
  claimPublicKey: CLAIM_PUBLIC_KEY,
  feeSompi: "200000",
  fundingAddress: V1_ADDRESS,
  linkKey: "lab-def456",
  redeemScriptHex: V1_SCRIPT,
  refundLockTime: "500000000",
  refundPublicKey: REFUND_PUBLIC_KEY,
  title: "Classic link",
};

describe("parseClaimableRegistration", () => {
  beforeEach(() => {
    vi.stubEnv("CLAIMABLE_AUTO_RETURN_ENABLED", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a canonical v2 link without a refund key", () => {
    const result = parseClaimableRegistration(v2Body, { requireAutoReturn: true });

    expect(result).toMatchObject({
      immutableData: {
        refundPublicKey: null,
        returnAddress: RETURN_ADDRESS,
        scriptVersion: 2,
        title: "Coffee for Ada",
      },
      linkKey: "lab-abc123",
      ok: true,
    });
  });

  it("requires auto-return for account-free links", () => {
    expect(parseClaimableRegistration(v1Body, { requireAutoReturn: true })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(parseClaimableRegistration(v1Body)).toMatchObject({
      immutableData: { refundPublicKey: REFUND_PUBLIC_KEY, scriptVersion: 1 },
      ok: true,
    });
  });

  it("refuses v2 links while auto-return is switched off", () => {
    vi.stubEnv("CLAIMABLE_AUTO_RETURN_ENABLED", "false");
    expect(parseClaimableRegistration(v2Body)).toMatchObject({
      message: "Auto-return claimable links are not enabled on this deployment.",
      ok: false,
    });
  });

  it("rejects a forged script, a bad key and a missing title", () => {
    expect(
      parseClaimableRegistration({ ...v2Body, returnAddress: V1_ADDRESS.replace("pp", "qq") }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(parseClaimableRegistration({ ...v2Body, linkKey: "../etc" })).toMatchObject({
      ok: false,
    });
    expect(parseClaimableRegistration({ ...v2Body, title: "" })).toMatchObject({ ok: false });
  });
});
