import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRenderClaimableSocialPreview } = vi.hoisted(() => ({
  mockRenderClaimableSocialPreview: vi.fn(),
}));

vi.mock("@/lib/claimable-social-preview", () => ({
  renderClaimableSocialPreview: mockRenderClaimableSocialPreview,
}));

import ClaimLinkOpenGraphImage from "./opengraph-image";

describe("claimable native OpenGraph image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRenderClaimableSocialPreview.mockResolvedValue(new Response("png"));
  });

  it("renders the link identified by the route path", async () => {
    await ClaimLinkOpenGraphImage({ params: Promise.resolve({ linkKey: "lab-123" }) });

    expect(mockRenderClaimableSocialPreview).toHaveBeenCalledWith("lab-123");
  });
});
