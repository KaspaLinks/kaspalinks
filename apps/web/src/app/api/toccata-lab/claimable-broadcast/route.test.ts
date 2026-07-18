import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockIndexer, mockPrisma } = vi.hoisted(() => ({
  mockIndexer: {
    findTransactionPayment: vi.fn(),
  },
  mockPrisma: {
    claimableLink: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@kaspa-actions/db", () => ({ prisma: mockPrisma }));
vi.mock("@kaspa-actions/kaspa-indexer", () => ({
  createRestKaspaIndexer: () => mockIndexer,
}));

import { resetRateLimits } from "@/lib/rate-limit";

import { GET, POST } from "./route";

const fetchMock = vi.hoisted(() => vi.fn());

const SIGNED_TRANSACTION_ID = "cd80138b9ed26d22df44e43195ba5c92245f02e514584b2073b57206d79b4f3a";
const REFUND_LOCK_TIME = "500000000";
const LINK_KEY = "lab-registered-link";
const CLAIM_PUBLIC_KEY = "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa";
const REFUND_PUBLIC_KEY = "466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27";
const FUNDING_ADDRESS = "kaspa:ppkr0dzfr3ptks6w0238uzqrqr98h07a3rrplzlwdmau3hapzjma6qe42a2vh";
const REDEEM_SCRIPT_HEX =
  "63204f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aaac67b5040065cd1da26920466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27ac68";
const CLAIM_SIGNATURE_SCRIPT = `4241e532ad213be423d5b358f94f17c630a3b835763b240a8d0cef4b64aa6b874d719b84161bb069384cd4dbd46b8e1e4610b0ce38f8920bac6c3861fa82dae3487e01514c4f${REDEEM_SCRIPT_HEX}`;
const SIGNED_TRANSACTION_SAFE_JSON = JSON.stringify({
  gas: "0",
  id: SIGNED_TRANSACTION_ID,
  inputs: [
    {
      computeBudget: 11,
      index: 0,
      sequence: "0",
      sigOpCount: 0,
      signatureScript: CLAIM_SIGNATURE_SCRIPT,
      transactionId: "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
      utxo: {
        address: null,
        amount: "25000000",
        blockDaaScore: "0",
        covenantId: null,
        isCoinbase: false,
        scriptPublicKey:
          "0000aa20951dd6387fb66d3f35f6e8ada84dee92b8c34c35bf98750bfcbd6df102dcd01587",
      },
    },
  ],
  lockTime: "0",
  outputs: [
    {
      covenant: null,
      scriptPublicKey: "000020c3cbe0f8294f8686a9b225f9403c72f2b64ae47a9567f5ef6f6ad35e36b08e50ac",
      value: "24800000",
    },
  ],
  payload: "",
  storageMass: "0",
  subnetworkId: "0000000000000000000000000000000000000000",
  version: 1,
});
const REFUND_TRANSACTION_SAFE_JSON = JSON.stringify({
  ...JSON.parse(SIGNED_TRANSACTION_SAFE_JSON),
  inputs: [
    {
      ...JSON.parse(SIGNED_TRANSACTION_SAFE_JSON).inputs[0],
      signatureScript: JSON.parse(SIGNED_TRANSACTION_SAFE_JSON).inputs[0].signatureScript.replace(
        `51${"4c4f"}${REDEEM_SCRIPT_HEX}`,
        `00${"4c4f"}${REDEEM_SCRIPT_HEX}`,
      ),
    },
  ],
  lockTime: REFUND_LOCK_TIME,
});
const MISMATCH_CLAIM_TRANSACTION_SAFE_JSON = JSON.stringify({
  ...JSON.parse(SIGNED_TRANSACTION_SAFE_JSON),
  inputs: [
    {
      ...JSON.parse(SIGNED_TRANSACTION_SAFE_JSON).inputs[0],
      utxo: {
        ...JSON.parse(SIGNED_TRANSACTION_SAFE_JSON).inputs[0].utxo,
        amount: "24000000",
      },
    },
  ],
  outputs: [
    {
      ...JSON.parse(SIGNED_TRANSACTION_SAFE_JSON).outputs[0],
      value: "23800000",
    },
  ],
});
const MISMATCH_REFUND_TRANSACTION_SAFE_JSON = JSON.stringify({
  ...JSON.parse(MISMATCH_CLAIM_TRANSACTION_SAFE_JSON),
  inputs: [
    {
      ...JSON.parse(MISMATCH_CLAIM_TRANSACTION_SAFE_JSON).inputs[0],
      signatureScript: JSON.parse(
        MISMATCH_CLAIM_TRANSACTION_SAFE_JSON,
      ).inputs[0].signatureScript.replace(
        `51${"4c4f"}${REDEEM_SCRIPT_HEX}`,
        `00${"4c4f"}${REDEEM_SCRIPT_HEX}`,
      ),
    },
  ],
  lockTime: REFUND_LOCK_TIME,
});

function broadcastRequest(body: unknown) {
  return new Request("https://kaspalinks.com/api/toccata-lab/claimable-broadcast", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.24",
    },
    method: "POST",
  });
}

function registeredLink(overrides: Record<string, unknown> = {}) {
  return {
    amountSompi: 25_000_000n,
    claimPublicKey: CLAIM_PUBLIC_KEY,
    createdAt: new Date(0),
    feeSompi: 200_000n,
    fundingAddress: FUNDING_ADDRESS,
    fundingOutputIndex: 0,
    fundingTxId: "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
    id: "claimable-1",
    redeemScriptHex: REDEEM_SCRIPT_HEX,
    refundLockTime: REFUND_LOCK_TIME,
    refundPublicKey: REFUND_PUBLIC_KEY,
    status: "funded",
    ...overrides,
  };
}

describe("POST /api/toccata-lab/claimable-broadcast", () => {
  beforeEach(() => {
    mockPrisma.claimableLink.findUnique.mockReset();
    mockPrisma.claimableLink.updateMany.mockReset();
    mockIndexer.findTransactionPayment.mockReset();
    mockPrisma.claimableLink.findUnique.mockResolvedValue(registeredLink());
    mockPrisma.claimableLink.updateMany.mockResolvedValue({ count: 1 });
    mockIndexer.findTransactionPayment.mockResolvedValue({
      matchedSompi: 25_000_000n,
      outputIndex: 0,
      transactionId: "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
    resetRateLimits();
  });

  it("is disabled by default", async () => {
    const response = await POST(
      broadcastRequest({
        expectedTransactionId: SIGNED_TRANSACTION_ID,
        linkKey: LINK_KEY,
        transactionSafeJson: SIGNED_TRANSACTION_SAFE_JSON,
      }),
    );

    expect(response.status).toBe(403);
  });

  it("submits signed SafeJSON without accepting spend codes", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_WRPC_RELAY_URL", "http://toccata-relay:3010");
    vi.stubGlobal("fetch", fetchMock);
    mockBlockDag("499999999");
    mockRelaySubmit();

    const response = await POST(
      broadcastRequest({
        expectedTransactionId: SIGNED_TRANSACTION_ID,
        linkKey: LINK_KEY,
        transactionSafeJson: SIGNED_TRANSACTION_SAFE_JSON,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      broadcast: {
        submittedTransactionId: SIGNED_TRANSACTION_ID,
        transactionId: SIGNED_TRANSACTION_ID,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/submit", "http://toccata-relay:3010"),
      expect.objectContaining({
        body: expect.any(String),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const relayPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      expectedTransactionId: string;
      transactionSafeJson: string;
    };
    expect(relayPayload).toEqual({
      expectedTransactionId: SIGNED_TRANSACTION_ID,
      transactionSafeJson: SIGNED_TRANSACTION_SAFE_JSON,
    });
  });

  it("rejects claims after the claim window has expired", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_WRPC_RELAY_URL", "http://toccata-relay:3010");
    vi.stubGlobal("fetch", fetchMock);
    mockBlockDag(REFUND_LOCK_TIME);
    mockRelaySubmit();

    const response = await POST(
      broadcastRequest({
        expectedTransactionId: SIGNED_TRANSACTION_ID,
        linkKey: LINK_KEY,
        transactionSafeJson: SIGNED_TRANSACTION_SAFE_JSON,
      }),
    );

    expect(response.status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_STATE",
        message:
          "Claim window has expired. This link can no longer be claimed through Kaspa Links.",
      },
    });
  });

  it("rejects refunds before the claim window has expired", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_WRPC_RELAY_URL", "http://toccata-relay:3010");
    vi.stubGlobal("fetch", fetchMock);
    mockBlockDag("499999999");
    mockRelaySubmit();

    const response = await POST(
      broadcastRequest({
        expectedTransactionId: SIGNED_TRANSACTION_ID,
        linkKey: LINK_KEY,
        transactionSafeJson: REFUND_TRANSACTION_SAFE_JSON,
      }),
    );

    expect(response.status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_STATE",
        message: "Refund is not available until the claim window has expired.",
      },
    });
  });

  it("never lets a mismatched funding amount use the claim branch", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      broadcastRequest({
        expectedTransactionId: SIGNED_TRANSACTION_ID,
        linkKey: LINK_KEY,
        transactionSafeJson: MISMATCH_CLAIM_TRANSACTION_SAFE_JSON,
      }),
    );

    expect(response.status).toBe(400);
    expect(mockIndexer.findTransactionPayment).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_BODY",
        message: "A claim must spend the exact amount registered for this claimable link.",
      },
    });
  });

  it("recovers a mismatched funding output after expiry without closing the link", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_WRPC_RELAY_URL", "http://toccata-relay:3010");
    vi.stubGlobal("fetch", fetchMock);
    mockPrisma.claimableLink.findUnique.mockResolvedValue(registeredLink({ status: "claimed" }));
    mockIndexer.findTransactionPayment.mockResolvedValue({
      matchedSompi: 24_000_000n,
      outputIndex: 0,
      transactionId: "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309",
    });
    mockBlockDag(REFUND_LOCK_TIME);
    mockRelaySubmit();

    const response = await POST(
      broadcastRequest({
        expectedTransactionId: SIGNED_TRANSACTION_ID,
        linkKey: LINK_KEY,
        transactionSafeJson: MISMATCH_REFUND_TRANSACTION_SAFE_JSON,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      broadcast: { submittedTransactionId: SIGNED_TRANSACTION_ID },
      mismatchRecovery: true,
    });
    expect(mockIndexer.findTransactionPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountSompi: 24_000_000n }),
    );
    expect(mockPrisma.claimableLink.updateMany).not.toHaveBeenCalled();
  });

  it("rejects unsigned transaction JSON", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_WRPC_RELAY_URL", "http://toccata-relay:3010");
    vi.stubGlobal("fetch", fetchMock);
    mockBlockDag("499999999");
    mockRelaySubmit();
    const unsigned = JSON.stringify({
      ...JSON.parse(SIGNED_TRANSACTION_SAFE_JSON),
      inputs: [
        {
          ...JSON.parse(SIGNED_TRANSACTION_SAFE_JSON).inputs[0],
          signatureScript: "",
        },
      ],
    });

    const response = await POST(
      broadcastRequest({
        expectedTransactionId: SIGNED_TRANSACTION_ID,
        linkKey: LINK_KEY,
        transactionSafeJson: unsigned,
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_BODY",
      },
    });
  });

  it("rejects a signed transaction that is not bound to a registered link", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubGlobal("fetch", fetchMock);
    mockPrisma.claimableLink.findUnique.mockResolvedValue(null);

    const response = await POST(
      broadcastRequest({
        expectedTransactionId: SIGNED_TRANSACTION_ID,
        linkKey: "unknown-link",
        transactionSafeJson: SIGNED_TRANSACTION_SAFE_JSON,
      }),
    );

    expect(response.status).toBe(404);
    expect(mockIndexer.findTransactionPayment).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects corrupted registered script metadata before relaying", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubGlobal("fetch", fetchMock);
    mockPrisma.claimableLink.findUnique.mockResolvedValue(
      registeredLink({ redeemScriptHex: `${REDEEM_SCRIPT_HEX.slice(0, -2)}00` }),
    );

    const response = await POST(
      broadcastRequest({
        expectedTransactionId: SIGNED_TRANSACTION_ID,
        linkKey: LINK_KEY,
        transactionSafeJson: SIGNED_TRANSACTION_SAFE_JSON,
      }),
    );

    expect(response.status).toBe(409);
    expect(mockIndexer.findTransactionPayment).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("derives the claim branch instead of trusting a client mode field", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_WRPC_RELAY_URL", "http://toccata-relay:3010");
    vi.stubGlobal("fetch", fetchMock);
    mockBlockDag("499999999");
    mockRelaySubmit();

    const response = await POST(
      broadcastRequest({
        expectedTransactionId: SIGNED_TRANSACTION_ID,
        linkKey: LINK_KEY,
        mode: "refund",
        refundLockTime: "0",
        transactionSafeJson: SIGNED_TRANSACTION_SAFE_JSON,
      }),
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.claimableLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "claimed" }),
      }),
    );
  });

  it("returns JSON for unsupported methods", async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});

function mockRelaySubmit() {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        localTransactionId: SIGNED_TRANSACTION_ID,
        submittedTransactionId: SIGNED_TRANSACTION_ID,
      }),
      {
        headers: { "content-type": "application/json" },
        status: 200,
      },
    ),
  );
}

function mockBlockDag(virtualDaaScore: string) {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        networkName: "kaspa-mainnet",
        pastMedianTime: "1783320154791",
        virtualDaaScore,
      }),
      {
        headers: { "content-type": "application/json" },
        status: 200,
      },
    ),
  );
}
