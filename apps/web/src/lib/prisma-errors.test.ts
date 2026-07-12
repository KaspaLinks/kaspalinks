import { describe, expect, it } from "vitest";

import { isPrismaUniqueConstraintError } from "./prisma-errors";

describe("prisma error helpers", () => {
  it("recognizes Prisma unique constraint errors", () => {
    expect(
      isPrismaUniqueConstraintError({
        code: "P2002",
        meta: { target: ["creatorId", "slug"] },
      }),
    ).toBe(true);
  });

  it("matches requested unique target fields", () => {
    const error = {
      code: "P2002",
      meta: { target: ["creatorId", "slug"] },
    };

    expect(isPrismaUniqueConstraintError(error, ["creatorId", "slug"])).toBe(true);
    expect(isPrismaUniqueConstraintError(error, ["username"])).toBe(false);
  });

  it("rejects unrelated errors", () => {
    expect(isPrismaUniqueConstraintError(new Error("nope"))).toBe(false);
    expect(isPrismaUniqueConstraintError({ code: "P2025" })).toBe(false);
  });
});
