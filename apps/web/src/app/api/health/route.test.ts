import { describe, expect, it } from "vitest";

import { GET, POST } from "./route";

describe("GET /api/health", () => {
  it("returns a healthy JSON response", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      commit: null,
      service: "kaspa-actions",
      status: "ok",
      version: "0.1.0",
    });
  });

  it("returns JSON for unsupported methods", async () => {
    const response = POST();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Allowed methods: GET.",
      },
    });
  });
});
