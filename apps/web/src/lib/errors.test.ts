import { describe, expect, it } from "vitest";

import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "./errors";

describe("apiError", () => {
  it("returns a JSON error with the documented shape", async () => {
    const response = apiError(ErrorCodes.NOT_FOUND, "Resource missing.", 404);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      error: { code: "NOT_FOUND", message: "Resource missing." },
    });
  });

  it("merges extra headers", () => {
    const response = apiError(ErrorCodes.RATE_LIMITED, "slow down", 429, {
      "Retry-After": "30",
    });

    expect(response.headers.get("retry-after")).toBe("30");
  });
});

describe("apiJson", () => {
  it("serializes bigint values as strings", async () => {
    const response = apiJson({ amountSompi: 1_000_000_000n });
    const text = await response.text();
    expect(text).toBe('{"amountSompi":"1000000000"}');
    expect(response.status).toBe(200);
  });
});

describe("apiMethodNotAllowed", () => {
  it("returns the documented JSON error shape and Allow header", async () => {
    const response = apiMethodNotAllowed(["GET", "POST"]);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: ErrorCodes.METHOD_NOT_ALLOWED,
        message: "Allowed methods: GET, POST.",
      },
    });
  });
});
