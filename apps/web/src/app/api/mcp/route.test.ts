import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLimit } = vi.hoisted(() => ({
  mockLimit: vi.fn((): { allowed: boolean; response?: Response } => ({ allowed: true })),
}));

vi.mock("@/lib/featured-giveaway", () => ({ loadOpenGiveaways: vi.fn(async () => []) }));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mockLimit,
  RateBuckets: { MCP_REQUEST: "mcp.request" },
}));

import { GET, POST } from "./route";

function post(body: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://kaspalinks.com/api/mcp", {
      body,
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...headers,
      },
      method: "POST",
    }),
  );
}

describe("/api/mcp", () => {
  beforeEach(() => {
    mockLimit.mockReset();
    mockLimit.mockReturnValue({ allowed: true });
  });

  it("answers tools/list with JSON", async () => {
    const response = await post(JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toHaveLength(4);
  });

  it("accepts a notification with 202 and no body", async () => {
    const response = await post(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("rejects bad JSON, unsupported protocol versions and oversized bodies", async () => {
    expect((await post("{")).status).toBe(400);
    const unsupported = await post(
      JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
      {
        "mcp-protocol-version": "2024-01-01",
      },
    );
    expect(((await unsupported.json()) as { error: { code: number } }).error.code).toBe(-32022);
    expect(
      (
        await post(JSON.stringify({ id: 1, jsonrpc: "2.0", method: "ping" }), {
          "mcp-protocol-version": "2024-01-01",
        })
      ).status,
    ).toBe(400);
    expect((await post(" ".repeat(64_001))).status).toBe(413);
  });

  it("passes the rate limit response through", async () => {
    mockLimit.mockReturnValue({ allowed: false, response: new Response(null, { status: 429 }) });
    expect((await post("{}")).status).toBe(429);
  });

  it("passes the routing headers through and refuses foreign origins", async () => {
    const mismatch = await post(JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }), {
      "mcp-method": "tools/call",
      "mcp-protocol-version": "2026-07-28",
    });
    expect(mismatch.status).toBe(400);
    expect(
      (
        await post(JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }), {
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post(JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }), {
          origin: "https://kaspalinks.com",
        })
      ).status,
    ).toBe(200);
  });

  it("offers no GET stream", async () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
