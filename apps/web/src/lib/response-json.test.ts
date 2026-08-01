import { describe, expect, it } from "vitest";

import { readJsonResponse } from "./response-json";

describe("readJsonResponse", () => {
  it("returns parsed JSON", async () => {
    await expect(
      readJsonResponse<{ ok: boolean }>(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("returns null for an empty response", async () => {
    await expect(readJsonResponse(new Response(null, { status: 503 }))).resolves.toBeNull();
  });

  it("returns null for a non-JSON response", async () => {
    await expect(
      readJsonResponse(new Response("upstream error", { status: 502 })),
    ).resolves.toBeNull();
  });
});
