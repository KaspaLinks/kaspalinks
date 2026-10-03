import { describe, expect, it } from "vitest";

import {
  buildCreateProfileHref,
  buildSignInHref,
  parseSignupSource,
  signupSourceSchema,
} from "./signup-source";

describe("signup source", () => {
  it("accepts only allowlisted labels, normalized", () => {
    expect(parseSignupSource("pay-success")).toBe("pay-success");
    expect(parseSignupSource(" Claim-Success ")).toBe("claim-success");
    expect(parseSignupSource("pay-share")).toBeNull();
    expect(parseSignupSource("x")).toBeNull();
    expect(parseSignupSource("")).toBeNull();
    expect(parseSignupSource(`pay-success${" ".repeat(40)}x`)).toBeNull();
    expect(parseSignupSource(["pay-success"])).toBeNull();
    expect(parseSignupSource(undefined)).toBeNull();
    expect(parseSignupSource(42)).toBeNull();
  });

  it("validates labels strictly in the schema", () => {
    expect(signupSourceSchema.safeParse("claim-success").success).toBe(true);
    expect(signupSourceSchema.safeParse("Claim-Success").success).toBe(false);
  });

  it("builds create-profile links that keep next and the label", () => {
    expect(buildCreateProfileHref({ next: "/new-link", signupSource: "pay-success" })).toBe(
      "/create-profile?next=%2Fnew-link&utm_source=pay-success",
    );
    expect(buildCreateProfileHref({ next: "/dashboard" })).toBe(
      "/create-profile?next=%2Fdashboard",
    );
  });

  it("keeps the plain sign-in link when there is nothing to carry over", () => {
    expect(buildSignInHref({ next: "/dashboard" })).toBe("/sign-in");
    expect(buildSignInHref({ next: "/dashboard", signupSource: null })).toBe("/sign-in");
    expect(buildSignInHref({ next: "/claim/create", signupSource: "claim-success" })).toBe(
      "/sign-in?next=%2Fclaim%2Fcreate&utm_source=claim-success",
    );
    expect(buildSignInHref({ next: "/new-link" })).toBe("/sign-in?next=%2Fnew-link");
  });
});
