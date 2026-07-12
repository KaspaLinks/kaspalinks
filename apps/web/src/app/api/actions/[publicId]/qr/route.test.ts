import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockQrToBuffer, mockQrToString } = vi.hoisted(() => ({
  mockPrisma: {
    action: {
      findUnique: vi.fn(),
    },
  },
  mockQrToBuffer: vi.fn(),
  mockQrToString: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  ActionType: {
    KASPA_DONATION: "KASPA_DONATION",
    KASPA_INVOICE: "KASPA_INVOICE",
    KASPA_TIP: "KASPA_TIP",
    KASPA_TRANSFER: "KASPA_TRANSFER",
  },
  Network: {
    MAINNET: "MAINNET",
    TESTNET: "TESTNET",
  },
  prisma: mockPrisma,
}));

vi.mock("qrcode", () => ({
  default: {
    toBuffer: mockQrToBuffer,
    toString: mockQrToString,
  },
}));

import { GET } from "./route";

function request(path = "/api/actions/pub-1/qr?format=svg&size=512") {
  return new Request(`https://kaspalinks.com${path}`);
}

function context(publicId = "pub-1") {
  return { params: Promise.resolve({ publicId }) };
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    creator: { username: "ada" },
    deletedAt: null,
    disabledAt: null,
    expiresAt: null,
    publicId: "pub-1",
    slug: "tip-jar",
    ...overrides,
  };
}

describe("GET /api/actions/:publicId/qr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://kaspalinks.com";
    mockQrToString.mockResolvedValue("<svg>mock</svg>");
    mockQrToBuffer.mockResolvedValue(Buffer.from("png"));
  });

  it("renders an SVG QR code for the human-readable Action URL", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(action());

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(mockPrisma.action.findUnique).toHaveBeenCalledWith({
      include: { creator: { select: { username: true } } },
      where: { publicId: "pub-1" },
    });
    expect(mockQrToString).toHaveBeenCalledWith(
      "https://kaspalinks.com/u/ada/tip-jar",
      expect.objectContaining({ type: "svg", width: 512 }),
    );
  });

  it("falls back to the legacy publicId URL when there is no creator slug", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(action({ creator: null, slug: null }));

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(mockQrToString).toHaveBeenCalledWith(
      "https://kaspalinks.com/a/pub-1",
      expect.objectContaining({ type: "svg" }),
    );
  });

  it("renders a PNG QR code when requested", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(action());

    const response = await GET(request("/api/actions/pub-1/qr?format=png&size=1024"), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(mockQrToBuffer).toHaveBeenCalledWith(
      "https://kaspalinks.com/u/ada/tip-jar",
      expect.objectContaining({ type: "png", width: 1024 }),
    );
  });

  it("rejects disabled Actions", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(action({ disabledAt: new Date() }));

    const response = await GET(request(), context());

    expect(response.status).toBe(403);
    expect(mockQrToString).not.toHaveBeenCalled();
  });
});
