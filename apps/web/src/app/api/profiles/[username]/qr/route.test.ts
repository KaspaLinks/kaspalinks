import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockQrToBuffer, mockQrToString } = vi.hoisted(() => ({
  mockPrisma: {
    creator: {
      findUnique: vi.fn(),
    },
  },
  mockQrToBuffer: vi.fn(),
  mockQrToString: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("qrcode", () => ({
  default: {
    toBuffer: mockQrToBuffer,
    toString: mockQrToString,
  },
}));

import { GET } from "./route";

function request(path = "/api/profiles/ada/qr?format=svg&size=512") {
  return new Request(`https://kaspalinks.com${path}`);
}

function context(username = "ada") {
  return { params: Promise.resolve({ username }) };
}

describe("GET /api/profiles/:username/qr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://kaspalinks.com";
    mockQrToString.mockResolvedValue("<svg>mock</svg>");
    mockQrToBuffer.mockResolvedValue(Buffer.from("png"));
  });

  it("renders an SVG QR code for the public profile URL", async () => {
    mockPrisma.creator.findUnique.mockResolvedValue({ username: "ada" });

    const response = await GET(request(), context("Ada"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(mockPrisma.creator.findUnique).toHaveBeenCalledWith({
      select: { username: true },
      where: { username: "ada" },
    });
    expect(mockQrToString).toHaveBeenCalledWith(
      "https://kaspalinks.com/u/ada",
      expect.objectContaining({ type: "svg", width: 512 }),
    );
  });

  it("renders a PNG QR code when requested", async () => {
    mockPrisma.creator.findUnique.mockResolvedValue({ username: "ada" });

    const response = await GET(request("/api/profiles/ada/qr?format=png&size=2048"), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(mockQrToBuffer).toHaveBeenCalledWith(
      "https://kaspalinks.com/u/ada",
      expect.objectContaining({ type: "png", width: 2048 }),
    );
  });

  it("validates QR size", async () => {
    const response = await GET(request("/api/profiles/ada/qr?format=svg&size=999"), context());

    expect(response.status).toBe(400);
    expect(mockPrisma.creator.findUnique).not.toHaveBeenCalled();
  });

  it("returns not found for missing profiles", async () => {
    mockPrisma.creator.findUnique.mockResolvedValue(null);

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(mockQrToString).not.toHaveBeenCalled();
  });
});
