import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockWriteAuditLog } = vi.hoisted(() => ({
  mockPrisma: {
    action: { findFirst: vi.fn(), update: vi.fn() },
    paymentRequest: { aggregate: vi.fn(), findMany: vi.fn() },
  },
  mockWriteAuditLog: vi.fn(async () => {}),
}));

vi.mock("@kaspa-actions/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kaspa-actions/db")>()),
  prisma: mockPrisma,
}));

vi.mock("@/lib/audit", () => ({ writeAuditLog: mockWriteAuditLog }));

vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: () => ({ allowed: true }),
  RateBuckets: { ACCOUNT_FREE_LINK_MANAGE: "account-free-link.manage" },
}));

import { hashManageToken } from "@/lib/account-free-links";

import { DELETE, GET, PATCH } from "./route";

const TOKEN = "T".repeat(43);
const context = { params: Promise.resolve({ publicId: "pub123" }) };

const ACTION = {
  agentCommandKey: null,
  amountSompi: null,
  createdAt: new Date("2026-10-18T10:00:00.000Z"),
  createdWithoutAccount: true,
  creatorId: null,
  deletedAt: null,
  description: null,
  disabledAt: null,
  expiresAt: null,
  goalAutoClose: false,
  goalSompi: null,
  hiddenFromProfile: true,
  id: "action-1",
  invoicePaidAt: null,
  manageTokenHash: hashManageToken(TOKEN),
  message: null,
  network: "MAINNET",
  noteRequired: false,
  publicId: "pub123",
  recipientAddress: "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j",
  slug: null,
  source: null,
  title: "Buy me a coffee",
  type: "KASPA_TIP",
  updatedAt: new Date("2026-10-18T10:00:00.000Z"),
  version: "v1",
};

function request(method: string, token: null | string, body?: unknown) {
  return new Request("https://kaspalinks.com/api/actions/pub123/manage", {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { "x-manage-token": token }),
    },
    method,
  });
}

describe("/api/actions/[publicId]/manage", () => {
  beforeEach(() => {
    mockPrisma.action.findFirst.mockImplementation(
      async ({ where }: { where: { manageTokenHash: string } }) =>
        where.manageTokenHash === hashManageToken(TOKEN) ? ACTION : null,
    );
    mockPrisma.action.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...ACTION,
      ...data,
    }));
    mockPrisma.paymentRequest.aggregate.mockResolvedValue({
      _count: { _all: 2 },
      _sum: { amountSompi: 300_000_000n },
    });
    mockPrisma.paymentRequest.findMany.mockResolvedValue([
      {
        amountSompi: 200_000_000n,
        confirmedAt: new Date("2026-10-18T11:00:00.000Z"),
        supporterMessage: "Great work",
        supporterName: "Ada",
        txId: "f".repeat(64),
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("answers 404 without the right token and never looks up adopted links", async () => {
    expect((await GET(request("GET", null), context)).status).toBe(404);
    expect((await GET(request("GET", "x".repeat(43)), context)).status).toBe(404);
    expect((await GET(request("GET", "short"), context)).status).toBe(404);
    expect(mockPrisma.action.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ creatorId: null, deletedAt: null, publicId: "pub123" }),
    });
  });

  it("shows the link and its confirmed payments", async () => {
    const response = await GET(request("GET", TOKEN), context);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.action).toMatchObject({ disabled: false, sharePath: "/a/pub123" });
    expect(json.payments).toMatchObject({ confirmedCount: 2, totalKas: "3" });
    expect(json.payments.recent[0]).toMatchObject({ amountKas: "2", supporterName: "Ada" });
    expect(JSON.stringify(json)).not.toContain(String(hashManageToken(TOKEN)));
  });

  it("shows a new link without payments", async () => {
    mockPrisma.paymentRequest.aggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _sum: { amountSompi: null },
    });
    mockPrisma.paymentRequest.findMany.mockResolvedValueOnce([]);
    const response = await GET(request("GET", TOKEN), context);
    expect(response.status).toBe(200);
    expect((await response.json()).payments).toEqual({
      confirmedCount: 0,
      recent: [],
      totalKas: "0",
    });
  });

  it("pauses and resumes the link", async () => {
    const paused = await PATCH(request("PATCH", TOKEN, { disabled: true }), context);
    expect(paused.status).toBe(200);
    expect(mockPrisma.action.update).toHaveBeenCalledWith({
      data: { disabledAt: expect.any(Date) },
      where: { id: "action-1" },
    });
    expect((await PATCH(request("PATCH", TOKEN, { disabled: "yes" }), context)).status).toBe(400);
  });

  it("deletes the link and retires the token", async () => {
    const response = await DELETE(request("DELETE", TOKEN), context);
    expect(response.status).toBe(200);
    expect(mockPrisma.action.update).toHaveBeenCalledWith({
      data: { deletedAt: expect.any(Date), disabledAt: expect.any(Date), manageTokenHash: null },
      where: { id: "action-1" },
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ event: "action.account_free_deleted" }),
    );
  });
});
