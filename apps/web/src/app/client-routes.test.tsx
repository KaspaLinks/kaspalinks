import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

Object.assign(globalThis, { React });

describe("client route smoke rendering", () => {
  it("renders the sign-in route shell", async () => {
    const { default: SignInPage } = await import("./sign-in/page");
    const markup = renderToStaticMarkup(<SignInPage />);
    expect(markup).toContain("Welcome back");
    expect(markup).toContain("we cannot retrieve a lost token later");
  });

  it("renders the create-profile route shell", async () => {
    const { default: CreateProfilePage } = await import("./create-profile/page");
    const markup = renderToStaticMarkup(<CreateProfilePage />);
    expect(markup).toContain("Start sharing Kaspa links");
    expect(markup).toContain("cannot read the token back later");
  });

  it("renders client-hydrated route placeholders without crashing", async () => {
    const [
      { default: NewLinkPage },
      { default: MyLinksPage },
      { default: MyProfilePage },
      { default: DashboardPage },
    ] = await Promise.all([
      import("./new-link/page"),
      import("./my-links/page"),
      import("./my-profile/page"),
      import("./dashboard/page"),
    ]);

    expect(renderToStaticMarkup(<NewLinkPage />)).toContain("Loading...");
    expect(renderToStaticMarkup(<MyLinksPage />)).toContain("Loading...");
    expect(renderToStaticMarkup(<MyProfilePage />)).toContain("Loading...");
    expect(renderToStaticMarkup(<DashboardPage />)).toContain("Loading...");
  });

  it("renders the focused batch recovery route", async () => {
    const { default: BatchRecoveryPage } = await import("./claim/batch-recovery/page");
    const markup = renderToStaticMarkup(<BatchRecoveryPage />);
    expect(markup).toContain("Recover a claim batch");
    expect(markup).toContain("Choose your private recovery bundle");
    expect(markup).not.toContain("Create a claim drop");
  });

  it("renders the public claim drop route", async () => {
    const { default: ClaimBatchPage } = await import("./claim/batch/page");
    const markup = renderToStaticMarkup(<ClaimBatchPage />);
    expect(markup).toContain("Create multiple claim links at once");
    expect(markup).toContain("Create a claim drop");
    expect(markup).not.toContain("Private lab");
  });
});
