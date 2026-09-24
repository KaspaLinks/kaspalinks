import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../_lib/use-creator-session", () => ({
  useCreatorSession: () => ({
    hydrated: true,
    signedIn: true,
    token: "creator-token",
    username: "example",
  }),
}));

Object.assign(globalThis, { React });

import { NewEscrowClient } from "./NewEscrowClient";

describe("new escrow creator", () => {
  it("renders the persisted mediated Mainnet flow instead of the old fixture creator", () => {
    const markup = renderToStaticMarkup(<NewEscrowClient />);

    expect(markup).toContain("Private Mainnet canary");
    expect(markup).toContain("Create a protected deal");
    expect(markup).toContain("Independent mediator");
    expect(markup).toContain("Buyer inspection window");
    expect(markup).not.toContain("This prototype does not save links");
  });
});
