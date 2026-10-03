import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseCreatorSession } = vi.hoisted(() => ({
  mockUseCreatorSession: vi.fn(),
}));

vi.mock("@/app/use-creator-session", () => ({
  useCreatorSession: mockUseCreatorSession,
}));

Object.assign(globalThis, { React });

import { GrowthPrompt } from "./GrowthPrompt";

describe("GrowthPrompt", () => {
  beforeEach(() => {
    mockUseCreatorSession.mockReset();
  });

  it("invites signed-out payers to get paid themselves", () => {
    mockUseCreatorSession.mockReturnValue({ hydrated: true, signedIn: false });
    const markup = renderToStaticMarkup(<GrowthPrompt source="pay-success" />);

    expect(markup).toContain("Get paid in KAS yourself");
    expect(markup).toContain('href="/create-profile?next=%2Fnew-link&amp;utm_source=pay-success"');
  });

  it("invites signed-out claimers to send KAS the same way", () => {
    mockUseCreatorSession.mockReturnValue({ hydrated: true, signedIn: false });
    const markup = renderToStaticMarkup(<GrowthPrompt source="claim-success" />);

    expect(markup).toContain("Send KAS to a friend the same way");
    expect(markup).toContain("utm_source=claim-success");
  });

  it("links straight to the account-free claim form when available", () => {
    mockUseCreatorSession.mockReturnValue({ hydrated: true, signedIn: false });
    const markup = renderToStaticMarkup(<GrowthPrompt accountFree source="claim-success" />);

    expect(markup).toContain('href="/claim/create/single?utm_source=claim-success"');
    expect(markup).not.toContain("/create-profile");
  });

  it("stays hidden for signed-in creators and before hydration", () => {
    mockUseCreatorSession.mockReturnValue({ hydrated: true, signedIn: true });
    expect(renderToStaticMarkup(<GrowthPrompt source="pay-success" />)).toBe("");

    mockUseCreatorSession.mockReturnValue({ hydrated: false, signedIn: false });
    expect(renderToStaticMarkup(<GrowthPrompt source="pay-success" />)).toBe("");
  });
});
