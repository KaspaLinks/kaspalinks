import { afterEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

import { GET, POST } from "./route";

const FUNDING_ADDRESS = "kaspa:prclnra75kmgsm3hpt0cw692vg5p96udzfqnysjaywm8fw5v54et2jf8khjwf";

function fundingStatusRequest(body: unknown) {
  return new Request("https://kaspalinks.com/api/toccata-lab/funding-status", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.22",
    },
    method: "POST",
  });
}

describe("POST /api/toccata-lab/funding-status", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetRateLimits();
  });

  it("is disabled by default", async () => {
    const response = await POST(
      fundingStatusRequest({
        amountSompi: "25000000",
        fundingAddress: FUNDING_ADDRESS,
      }),
    );

    expect(response.status).toBe(403);
  });

  it("returns the exact funding transaction when detected", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              block_time: "1783170335272",
              is_accepted: true,
              outputs: [
                {
                  amount: "25000000",
                  index: 0,
                  script_public_key_address: FUNDING_ADDRESS,
                },
              ],
              transaction_id:
                "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              address: FUNDING_ADDRESS,
              outpoint: {
                index: 0,
                transactionId:
                  "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
              },
              utxoEntry: {
                amount: "25000000",
              },
            },
          ]),
          { status: 200 },
        ),
      );

    const response = await POST(
      fundingStatusRequest({
        amountSompi: "25000000",
        fundingAddress: FUNDING_ADDRESS,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      funded: true,
      match: {
        amountSompi: "25000000",
        blockTime: 1783170335272,
        outputIndex: 0,
        transactionId: "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
      },
      outputStatus: "funded_unspent",
      registeredStatus: null,
      spent: false,
    });
  });

  it("marks detected funding as spent when the exact output is no longer unspent", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              block_time: "1783170335272",
              is_accepted: true,
              outputs: [
                {
                  amount: "25000000",
                  index: 0,
                  script_public_key_address: FUNDING_ADDRESS,
                },
              ],
              transaction_id:
                "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const response = await POST(
      fundingStatusRequest({
        amountSompi: "25000000",
        fundingAddress: FUNDING_ADDRESS,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      funded: true,
      match: {
        amountSompi: "25000000",
        blockTime: 1783170335272,
        outputIndex: 0,
        transactionId: "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
      },
      outputStatus: "spent",
      registeredStatus: null,
      spent: true,
    });
  });

  it("checks a known funding transaction directly for old claim links", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            block_time: "1783170335272",
            is_accepted: true,
            outputs: [
              {
                amount: "25000000",
                index: 0,
                script_public_key_address: FUNDING_ADDRESS,
              },
            ],
            transaction_id:
              "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const response = await POST(
      fundingStatusRequest({
        amountSompi: "25000000",
        fundingAddress: FUNDING_ADDRESS,
        fundingOutputIndex: 0,
        fundingTransactionId:
          "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      funded: true,
      outputStatus: "spent",
      spent: true,
    });
  });

  it("keeps the link locked when no exact amount is found", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            is_accepted: true,
            outputs: [
              {
                amount: "24000000",
                index: 0,
                script_public_key_address: FUNDING_ADDRESS,
              },
            ],
            transaction_id:
              "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
          },
        ]),
        { status: 200 },
      ),
    );

    const response = await POST(
      fundingStatusRequest({
        amountSompi: "25000000",
        fundingAddress: FUNDING_ADDRESS,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      funded: false,
      match: null,
      outputStatus: "unfunded",
      registeredStatus: null,
      spent: false,
    });
  });

  it("rejects non-mainnet funding addresses before contacting the indexer", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await POST(
      fundingStatusRequest({
        amountSompi: "25000000",
        fundingAddress: "kaspatest:prclnra75kmgsm3hpt0cw692vg5p96udzfqnysjaywm8fw5v54et2jf8khjwf",
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_BODY",
      },
    });
  });

  it("rejects zero funding amounts before contacting the indexer", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await POST(
      fundingStatusRequest({
        amountSompi: "0",
        fundingAddress: FUNDING_ADDRESS,
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_BODY",
      },
    });
  });

  it("returns JSON for unsupported methods", async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
