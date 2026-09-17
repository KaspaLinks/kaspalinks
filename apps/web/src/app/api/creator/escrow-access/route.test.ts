import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockRequireCreator } = vi.hoisted(() => ({
  mockPrisma: {},
  mockRequireCreator: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mockRequireCreator }));

import { GET, POST } from "./route";

function request() {
  return new Request("https://kaspalinks.com/api/creator/escrow-access", {
    headers: { "x-creator-token": "token", "x-creator-username": "example" },
  });
}

describe("GET /api/creator/escrow-access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ESCROW_LINKS_PROTOTYPE_ENABLED = "true";
    process.env.ESCROW_LINKS_PROTOTYPE_CREATORS = "example";
  });

  afterEach(() => {
    delete process.env.ESCROW_LINKS_PROTOTYPE_ENABLED;
    delete process.env.ESCROW_LINKS_PROTOTYPE_CREATORS;
  });

  it("grants access to an allowlisted, authenticated creator", async () => {
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-example", username: "example" },
      ok: true,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ enabled: true });
  });

  it("answers 404 for creators who are not allowlisted", async () => {
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-other", username: "someone-else" },
      ok: true,
    });

    const response = await GET(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("passes authentication failures through unchanged", async () => {
    mockRequireCreator.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });

    expect((await GET(request())).status).toBe(401);
  });

  it("answers 404 without touching auth when the prototype is disabled", async () => {
    process.env.ESCROW_LINKS_PROTOTYPE_ENABLED = "false";

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockRequireCreator).not.toHaveBeenCalled();
  });

  it("only supports GET", () => {
    expect(POST().status).toBe(405);
  });
});
