import { describe, expect, it, vi } from "vitest";

import { createKaspaActionsClient, KaspaActionsApiError } from "./index";

const ACTION = {
  amountKas: "10",
  amountSompi: "1000000000",
  description: "Support this creator.",
  expiresAt: null,
  goalAutoClose: false,
  goalKas: null,
  goalSompi: null,
  message: "Thanks",
  network: "testnet",
  publicId: "demo-action",
  recipientAddress: "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz",
  title: "Tip Ada 10 KAS",
  type: "kaspa.tip",
  version: "v1",
};

const PAYMENT_REQUEST = {
  amountKas: "10",
  amountSompi: "1000000000",
  confirmedAt: null,
  createdAt: "2026-01-01T12:00:00.000Z",
  detectionSource: null,
  expiresAt: "2026-01-01T12:15:00.000Z",
  failedAt: null,
  fakeTxId: null,
  id: "payment-request-1",
  network: "testnet",
  paymentUri: "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz?amount=10",
  recipientAddress: "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz",
  requestedMessage: null,
  status: "PENDING",
  supporterMessage: null,
  supporterName: null,
  supporterPublic: false,
  txId: null,
};

describe("createKaspaActionsClient", () => {
  it("builds public Action URLs", () => {
    const client = createKaspaActionsClient({
      appUrl: "https://kaspa.example/base/?utm=ignored#top",
      fetch: fetchOk({ action: ACTION }),
    });

    expect(client.createActionUrl("demo-action")).toBe("https://kaspa.example/base/a/demo-action");
  });

  it("fetches public Action metadata", async () => {
    const fetch = fetchOk({ action: ACTION });
    const client = createKaspaActionsClient({ appUrl: "https://kaspa.example", fetch });

    await expect(client.getAction("demo-action")).resolves.toEqual(ACTION);
    expect(fetch).toHaveBeenCalledWith("https://kaspa.example/api/actions/demo-action", undefined);
  });

  it("creates payment requests with trimmed optional messages", async () => {
    const fetch = fetchOk({ paymentRequest: PAYMENT_REQUEST });
    const client = createKaspaActionsClient({ appUrl: "https://kaspa.example", fetch });

    await expect(
      client.createPaymentRequest("demo-action", { requestedMessage: "  thank you  " }),
    ).resolves.toEqual(PAYMENT_REQUEST);

    expect(fetch).toHaveBeenCalledWith(
      "https://kaspa.example/api/actions/demo-action/payment-requests",
      {
        body: JSON.stringify({ requestedMessage: "thank you" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
  });

  it("creates payment requests with trimmed supporter messages", async () => {
    const fetch = fetchOk({ paymentRequest: PAYMENT_REQUEST });
    const client = createKaspaActionsClient({ appUrl: "https://kaspa.example", fetch });

    await expect(
      client.createPaymentRequest("demo-action", { supporterMessage: "  great stream  " }),
    ).resolves.toEqual(PAYMENT_REQUEST);

    expect(fetch).toHaveBeenCalledWith(
      "https://kaspa.example/api/actions/demo-action/payment-requests",
      {
        body: JSON.stringify({ supporterMessage: "great stream" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
  });

  it("creates payment requests with public supporter wall attribution", async () => {
    const fetch = fetchOk({ paymentRequest: PAYMENT_REQUEST });
    const client = createKaspaActionsClient({ appUrl: "https://kaspa.example", fetch });

    await expect(
      client.createPaymentRequest("demo-action", {
        supporterMessage: "  great stream  ",
        supporterName: "  Ada  ",
        supporterPublic: true,
      }),
    ).resolves.toEqual(PAYMENT_REQUEST);

    expect(fetch).toHaveBeenCalledWith(
      "https://kaspa.example/api/actions/demo-action/payment-requests",
      {
        body: JSON.stringify({
          supporterMessage: "great stream",
          supporterPublic: true,
          supporterName: "Ada",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
  });

  it("fetches payment request status", async () => {
    const fetch = fetchOk({ paymentRequest: PAYMENT_REQUEST });
    const client = createKaspaActionsClient({ appUrl: "https://kaspa.example", fetch });

    await expect(client.getPaymentRequestStatus("payment-request-1")).resolves.toEqual(
      PAYMENT_REQUEST,
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://kaspa.example/api/payment-requests/payment-request-1/status",
      undefined,
    );
  });

  it("throws typed API errors for error envelopes", async () => {
    const fetch = fetchResponse(
      {
        error: {
          code: "NOT_FOUND",
          message: "Action not found.",
        },
      },
      404,
    );
    const client = createKaspaActionsClient({ appUrl: "https://kaspa.example", fetch });

    await expect(client.getAction("missing-action")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Action not found.",
      name: "KaspaActionsApiError",
      status: 404,
    } satisfies Partial<KaspaActionsApiError>);
  });

  it("rejects invalid successful response shapes", async () => {
    const fetch = fetchOk({ action: { ...ACTION, amountSompi: 1_000_000_000 } });
    const client = createKaspaActionsClient({ appUrl: "https://kaspa.example", fetch });

    await expect(client.getAction("demo-action")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 0,
    });
  });

  it("rejects unsafe inputs before sending requests", async () => {
    const fetch = fetchOk({ action: ACTION });
    const client = createKaspaActionsClient({ appUrl: "https://kaspa.example", fetch });

    expect(() => createKaspaActionsClient({ appUrl: "javascript:alert(1)", fetch })).toThrow(
      "appUrl must use http or https.",
    );
    await expect(client.getAction("../admin")).rejects.toThrow(
      "publicId must be 3-128 URL-safe characters.",
    );
    await expect(client.getPaymentRequestStatus("bad/id")).rejects.toThrow(
      "id must be a non-empty URL path segment.",
    );
    await expect(
      client.createPaymentRequest("demo-action", { requestedMessage: "x".repeat(281) }),
    ).rejects.toThrow("requestedMessage must be 280 characters or fewer.");
    await expect(
      client.createPaymentRequest("demo-action", { supporterMessage: "x".repeat(281) }),
    ).rejects.toThrow("supporterMessage must be 280 characters or fewer.");
    await expect(
      client.createPaymentRequest("demo-action", { supporterName: "x".repeat(41) }),
    ).rejects.toThrow("supporterName must be 40 characters or fewer.");
  });
});

function fetchOk(body: unknown) {
  return fetchResponse(body, 200);
}

function fetchResponse(body: unknown, status: number) {
  return vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status,
    });
  });
}
