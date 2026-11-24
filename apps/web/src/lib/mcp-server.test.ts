import { describe, expect, it, vi } from "vitest";

import { parseLinkPrefill } from "@/app/new-link/link-prefill";

import { handleMcpMessage, MCP_PROTOCOL_VERSIONS, type McpDependencies } from "./mcp-server";

const ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const APP = "https://kaspalinks.com";

function deps(overrides: Partial<McpDependencies> = {}): McpDependencies {
  return { appUrl: APP, loadOpenGiveaways: vi.fn(async () => []), ...overrides };
}

async function call(name: string, args?: unknown, dependencies = deps()) {
  const reply = await handleMcpMessage(
    { id: 7, jsonrpc: "2.0", method: "tools/call", params: { arguments: args, name } },
    dependencies,
  );
  expect(reply.status).toBe(200);
  return (reply.body as { result: Record<string, unknown> }).result as {
    content: { text: string; type: string }[];
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };
}

describe("MCP protocol", () => {
  it("negotiates a supported protocol version and falls back to the latest", async () => {
    const reply = await handleMcpMessage(
      {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "t", version: "1" },
          protocolVersion: "2025-06-18",
        },
      },
      deps(),
    );
    const result = (reply.body as { result: Record<string, unknown> }).result;
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(String(result.instructions)).toContain("never create links");

    const fallback = await handleMcpMessage(
      { id: 2, jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "1999-01-01" } },
      deps(),
    );
    expect((fallback.body as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      MCP_PROTOCOL_VERSIONS[0],
    );
  });

  it("accepts notifications and client responses without a body", async () => {
    expect(
      await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, deps()),
    ).toEqual({ body: null, status: 202 });
    expect(await handleMcpMessage({ id: 3, jsonrpc: "2.0", result: {} }, deps())).toEqual({
      body: null,
      status: 202,
    });
  });

  it("rejects batches, missing methods and unknown methods", async () => {
    expect(
      (await handleMcpMessage([{ id: 1, jsonrpc: "2.0", method: "ping" }], deps())).status,
    ).toBe(400);
    expect((await handleMcpMessage({ id: 1, jsonrpc: "2.0" }, deps())).status).toBe(400);
    const unknown = await handleMcpMessage(
      { id: 4, jsonrpc: "2.0", method: "resources/list" },
      deps(),
    );
    expect(unknown.body).toMatchObject({ error: { code: -32601 }, id: 4 });
  });

  it("answers ping and lists four read-only tools", async () => {
    expect(
      (await handleMcpMessage({ id: 5, jsonrpc: "2.0", method: "ping" }, deps())).body,
    ).toEqual({
      id: 5,
      jsonrpc: "2.0",
      result: {},
    });
    const listed = await handleMcpMessage({ id: 6, jsonrpc: "2.0", method: "tools/list" }, deps());
    const tools = (
      listed.body as {
        result: { tools: { annotations: { readOnlyHint: boolean }; name: string }[] };
      }
    ).result.tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "prepare_payment_link",
      "prepare_claim_link",
      "prepare_giveaway",
      "list_open_giveaways",
    ]);
    expect(tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
  });

  it("reports an unknown tool as invalid params", async () => {
    const reply = await handleMcpMessage(
      { id: 8, jsonrpc: "2.0", method: "tools/call", params: { name: "send_kas" } },
      deps(),
    );
    expect(reply.body).toMatchObject({ error: { code: -32602 }, id: 8 });
  });
});

describe("prepare_payment_link", () => {
  it("returns a prefilled form with the address after the #", async () => {
    const result = await call("prepare_payment_link", {
      amount_kas: 25,
      kind: "fixed",
      recipient_address: ADDRESS,
      title: "  Logo   design ",
    });
    expect(result.isError).toBeUndefined();
    const formUrl = String(result.structuredContent?.form_url);
    const url = new URL(formUrl);
    expect(`${url.origin}${url.pathname}`).toBe(`${APP}/new-link`);
    expect(url.searchParams.get("kind")).toBe("fixed");
    expect(url.searchParams.get("from")).toBe("mcp");
    expect(url.search).not.toContain("kaspa");
    expect(parseLinkPrefill(url.hash)).toEqual({
      amountKas: "25",
      recipientAddress: ADDRESS,
      title: "Logo design",
    });
    expect(result.structuredContent?.created).toBe(false);
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  });

  it("ignores the amount for tips and defaults to kind any", async () => {
    const result = await call("prepare_payment_link", {
      amount_kas: "5",
      recipient_address: ADDRESS,
    });
    const url = new URL(String(result.structuredContent?.form_url));
    expect(url.searchParams.get("kind")).toBe("any");
    expect(parseLinkPrefill(url.hash)).toEqual({ recipientAddress: ADDRESS });
  });

  it("refuses invalid, testnet and missing values as tool errors", async () => {
    expect((await call("prepare_payment_link", {})).isError).toBe(true);
    expect((await call("prepare_payment_link", { recipient_address: "kaspa:qqqq" })).isError).toBe(
      true,
    );
    const testnet = await call("prepare_payment_link", {
      recipient_address: "kaspatest:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j",
    });
    expect(testnet.isError).toBe(true);
    expect(
      (await call("prepare_payment_link", { kind: "goal", recipient_address: ADDRESS })).isError,
    ).toBe(true);
    const tooSmall = await call("prepare_payment_link", {
      amount_kas: "0.1",
      kind: "fixed",
      recipient_address: ADDRESS,
    });
    expect(tooSmall.isError).toBe(true);
    expect(tooSmall.content[0]!.text).toContain("0.2 KAS");
  });
});

describe("prepare_claim_link and prepare_giveaway", () => {
  it("points at the claim form, with a count for Claim Drops", async () => {
    expect((await call("prepare_claim_link", {})).structuredContent?.form_url).toBe(
      `${APP}/claim/create?from=mcp`,
    );
    const drop = await call("prepare_claim_link", { count: 4 });
    expect(drop.structuredContent?.form_url).toBe(`${APP}/claim/create?count=4&from=mcp`);
    expect(String(drop.structuredContent?.next_steps)).toContain("profile");
    expect((await call("prepare_claim_link", { count: 9 })).isError).toBe(true);
  });

  it("points at the giveaway studio", async () => {
    expect((await call("prepare_giveaway")).structuredContent?.form_url).toBe(
      `${APP}/giveaway/new?from=mcp`,
    );
  });
});

describe("list_open_giveaways", () => {
  it("lists numbers and links only, never creator text", async () => {
    const loadOpenGiveaways = vi.fn(async () => [
      {
        amountKas: "100",
        closesAt: new Date("2026-11-24T18:00:00.000Z"),
        participantCap: 32,
        participantCount: 12,
        publicId: "cmw6m0itx04jz01r32nhaa4g7",
      },
    ]);
    const result = await call("list_open_giveaways", { limit: 3 }, deps({ loadOpenGiveaways }));
    expect(loadOpenGiveaways).toHaveBeenCalledWith(3);
    expect(result.structuredContent?.giveaways).toEqual([
      {
        closes_at: "2026-11-24T18:00:00.000Z",
        entries: 12,
        free_spots: 20,
        page_url: `${APP}/giveaways/cmw6m0itx04jz01r32nhaa4g7?from=mcp`,
        prize_kas: "100",
      },
    ]);
  });

  it("says so when nothing is open", async () => {
    const result = await call("list_open_giveaways");
    expect(result.structuredContent?.giveaways).toEqual([]);
    expect(String(result.structuredContent?.note)).toContain("prepare_giveaway");
  });
});
