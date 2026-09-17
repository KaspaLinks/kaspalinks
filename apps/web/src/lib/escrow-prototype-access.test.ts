import { describe, expect, it } from "vitest";

import { isEscrowPrototypeCreator, isEscrowPrototypeEnabled } from "./escrow-prototype-access";

describe("escrow prototype access", () => {
  it("is on in development and off in production unless set explicitly", () => {
    expect(isEscrowPrototypeEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isEscrowPrototypeEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(isEscrowPrototypeEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(
      isEscrowPrototypeEnabled({ ESCROW_LINKS_PROTOTYPE_ENABLED: "true", NODE_ENV: "production" }),
    ).toBe(true);
    expect(
      isEscrowPrototypeEnabled({
        ESCROW_LINKS_PROTOTYPE_ENABLED: "false",
        NODE_ENV: "development",
      }),
    ).toBe(false);
  });

  it("only admits allowlisted creators", () => {
    const env = { ESCROW_LINKS_PROTOTYPE_CREATORS: " Example , second-creator ,," };

    expect(isEscrowPrototypeCreator("example", env)).toBe(true);
    expect(isEscrowPrototypeCreator("EXAMPLE", env)).toBe(true);
    expect(isEscrowPrototypeCreator("second-creator", env)).toBe(true);
    expect(isEscrowPrototypeCreator("examples", env)).toBe(false);
    expect(isEscrowPrototypeCreator("", env)).toBe(false);
  });

  it("admits nobody without an allowlist", () => {
    expect(isEscrowPrototypeCreator("example", {})).toBe(false);
    expect(isEscrowPrototypeCreator("example", { ESCROW_LINKS_PROTOTYPE_CREATORS: "" })).toBe(
      false,
    );
  });
});
