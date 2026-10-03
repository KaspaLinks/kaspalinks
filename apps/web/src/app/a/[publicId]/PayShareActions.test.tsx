import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PayShareActions } from "./PayShareActions";

Object.assign(globalThis, { React });

describe("PayShareActions", () => {
  it("starts with a single share button and no prebuilt link", () => {
    const markup = renderToStaticMarkup(<PayShareActions title="Coffee for Ada" />);

    expect(markup).toContain("Share this page");
    expect(markup).not.toContain("href=");
    expect(markup).not.toContain("Coffee for Ada");
  });
});
