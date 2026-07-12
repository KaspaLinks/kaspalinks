const MAX_REQUESTED_MESSAGE_LENGTH = 280;
const MAX_SUPPORTER_DISPLAY_NAME_LENGTH = 40;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const PUBLIC_ACTION_TYPES = [
  "kaspa.donation",
  "kaspa.goal",
  "kaspa.invoice",
  "kaspa.tip",
  "kaspa.transfer",
] as const;
const PAYMENT_REQUEST_STATUSES = ["PENDING", "CONFIRMED", "EXPIRED", "FAILED"] as const;

export type KaspaActionType = (typeof PUBLIC_ACTION_TYPES)[number];
export type KaspaNetwork = "mainnet" | "testnet";
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

export type PublicActionMetadata = {
  amountKas: null | string;
  amountSompi: null | string;
  description: null | string;
  expiresAt: null | string;
  // Goal-link settings. Additive v1 fields — older SDK builds that predate
  // goals simply ignore them.
  goalAutoClose: boolean;
  // Fundraising target for goal/crowdfunding links (type "kaspa.goal");
  // null for every other type.
  goalKas: null | string;
  goalSompi: null | string;
  message: null | string;
  network: KaspaNetwork;
  publicId: string;
  recipientAddress: string;
  title: string;
  type: KaspaActionType;
  version: "v1";
};

export type PaymentRequest = {
  amountKas: null | string;
  amountSompi: null | string;
  confirmedAt: null | string;
  createdAt: string;
  detectionSource: null | string;
  expiresAt: string;
  failedAt: null | string;
  fakeTxId: null | string;
  id: string;
  network: KaspaNetwork;
  paymentUri: null | string;
  recipientAddress: string;
  requestedMessage: null | string;
  status: PaymentRequestStatus;
  supporterMessage: null | string;
  supporterName: null | string;
  supporterPublic: boolean;
  txId: null | string;
};

export type CreatePaymentRequestInput = {
  amountKas?: string;
  requestedMessage?: string;
  supporterMessage?: string;
  supporterName?: string;
  supporterPublic?: boolean;
};

export type KaspaActionsClientOptions = {
  appUrl: string;
  fetch?: typeof fetch;
};

export type KaspaActionsClient = {
  createActionUrl(publicId: string): string;
  createPaymentRequest(
    publicId: string,
    input?: CreatePaymentRequestInput,
  ): Promise<PaymentRequest>;
  getAction(publicId: string): Promise<PublicActionMetadata>;
  getPaymentRequestStatus(id: string): Promise<PaymentRequest>;
};

export class KaspaActionsApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, options: { code: string; status: number }) {
    super(message);
    this.name = "KaspaActionsApiError";
    this.code = options.code;
    this.status = options.status;
  }
}

export function createKaspaActionsClient(options: KaspaActionsClientOptions): KaspaActionsClient {
  const appBaseUrl = normalizeAppBaseUrl(options.appUrl);
  const fetchFn = resolveFetch(options.fetch);

  async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetchFn(`${appBaseUrl}${path}`, init);
    return parseJsonResponse(response);
  }

  return {
    createActionUrl(publicId: string) {
      return `${appBaseUrl}/a/${encodeURIComponent(normalizePublicId(publicId))}`;
    },

    async createPaymentRequest(publicId: string, input: CreatePaymentRequestInput = {}) {
      const body = await requestJson(
        `/api/actions/${encodeURIComponent(normalizePublicId(publicId))}/payment-requests`,
        {
          body: JSON.stringify(normalizeCreatePaymentRequestInput(input)),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );

      return extractPaymentRequest(body);
    },

    async getAction(publicId: string) {
      const body = await requestJson(
        `/api/actions/${encodeURIComponent(normalizePublicId(publicId))}`,
      );
      return extractAction(body);
    },

    async getPaymentRequestStatus(id: string) {
      const body = await requestJson(
        `/api/payment-requests/${encodeURIComponent(normalizeId(id))}/status`,
      );
      return extractPaymentRequest(body);
    },
  };
}

function extractAction(value: unknown) {
  if (isRecord(value) && isPublicActionMetadata(value.action)) {
    return value.action;
  }

  throw invalidResponseError();
}

function extractPaymentRequest(value: unknown) {
  if (isRecord(value) && isPaymentRequest(value.paymentRequest)) {
    return value.paymentRequest;
  }

  throw invalidResponseError();
}

function invalidResponseError() {
  return new KaspaActionsApiError("Kaspa Actions API returned an invalid response.", {
    code: "INVALID_RESPONSE",
    status: 0,
  });
}

function isErrorEnvelope(value: unknown): value is { error: { code: string; message: string } } {
  return (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string"
  );
}

function isPaymentRequest(value: unknown): value is PaymentRequest {
  return (
    isRecord(value) &&
    isStringOrNull(value.amountKas) &&
    isStringOrNull(value.amountSompi) &&
    isStringOrNull(value.confirmedAt) &&
    typeof value.createdAt === "string" &&
    isStringOrNull(value.detectionSource) &&
    typeof value.expiresAt === "string" &&
    isStringOrNull(value.failedAt) &&
    isStringOrNull(value.fakeTxId) &&
    typeof value.id === "string" &&
    isKaspaNetwork(value.network) &&
    isStringOrNull(value.paymentUri) &&
    typeof value.recipientAddress === "string" &&
    isStringOrNull(value.requestedMessage) &&
    isPaymentRequestStatus(value.status) &&
    isStringOrNull(value.supporterMessage) &&
    isStringOrNull(value.supporterName) &&
    typeof value.supporterPublic === "boolean" &&
    isStringOrNull(value.txId)
  );
}

function isPaymentRequestStatus(value: unknown): value is PaymentRequestStatus {
  return PAYMENT_REQUEST_STATUSES.includes(value as PaymentRequestStatus);
}

function isPublicActionMetadata(value: unknown): value is PublicActionMetadata {
  return (
    isRecord(value) &&
    value.version === "v1" &&
    isPublicActionType(value.type) &&
    typeof value.title === "string" &&
    isStringOrNull(value.description) &&
    typeof value.recipientAddress === "string" &&
    isStringOrNull(value.amountSompi) &&
    isStringOrNull(value.amountKas) &&
    typeof value.goalAutoClose === "boolean" &&
    isStringOrNull(value.message) &&
    isStringOrNull(value.expiresAt) &&
    typeof value.publicId === "string" &&
    isKaspaNetwork(value.network)
  );
}

function isPublicActionType(value: unknown): value is KaspaActionType {
  return PUBLIC_ACTION_TYPES.includes(value as KaspaActionType);
}

function isKaspaNetwork(value: unknown): value is KaspaNetwork {
  return value === "mainnet" || value === "testnet";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is null | string {
  return value === null || typeof value === "string";
}

function normalizeAppBaseUrl(appUrl: string) {
  let parsed: URL;

  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error("appUrl must be a valid absolute URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("appUrl must use http or https.");
  }

  const basePath = parsed.pathname.replace(/\/+$/, "");

  return `${parsed.origin}${basePath === "/" ? "" : basePath}`;
}

function normalizeCreatePaymentRequestInput(input: CreatePaymentRequestInput) {
  const body: {
    amountKas?: string;
    requestedMessage?: string;
    supporterMessage?: string;
    supporterName?: string;
    supporterPublic?: boolean;
  } = {};

  if (input.amountKas !== undefined) {
    const amountKas = input.amountKas.trim();
    if (amountKas.length > 0) {
      body.amountKas = amountKas;
    }
  }

  if (input.requestedMessage !== undefined) {
    const requestedMessage = input.requestedMessage.trim();
    if (requestedMessage.length > MAX_REQUESTED_MESSAGE_LENGTH) {
      throw new Error(
        `requestedMessage must be ${MAX_REQUESTED_MESSAGE_LENGTH} characters or fewer.`,
      );
    }
    if (requestedMessage.length > 0) {
      body.requestedMessage = requestedMessage;
    }
  }

  if (input.supporterMessage !== undefined) {
    const supporterMessage = input.supporterMessage.trim();
    if (supporterMessage.length > MAX_REQUESTED_MESSAGE_LENGTH) {
      throw new Error(
        `supporterMessage must be ${MAX_REQUESTED_MESSAGE_LENGTH} characters or fewer.`,
      );
    }
    if (supporterMessage.length > 0) {
      body.supporterMessage = supporterMessage;
    }
  }

  const shouldPublishSupporter = input.supporterPublic === true;
  if (shouldPublishSupporter) {
    body.supporterPublic = true;
  }

  if (input.supporterName !== undefined) {
    const supporterName = input.supporterName.trim();
    if (supporterName.length > MAX_SUPPORTER_DISPLAY_NAME_LENGTH) {
      throw new Error(
        `supporterName must be ${MAX_SUPPORTER_DISPLAY_NAME_LENGTH} characters or fewer.`,
      );
    }
    if (supporterName.length > 0 && shouldPublishSupporter) {
      body.supporterName = supporterName;
    }
  }

  return body;
}

function normalizeId(id: string) {
  const normalized = id.trim();

  if (normalized.length === 0 || normalized.length > 128 || /[\s/]/.test(normalized)) {
    throw new Error("id must be a non-empty URL path segment.");
  }

  return normalized;
}

function normalizePublicId(publicId: string) {
  const normalized = publicId.trim();

  if (!PUBLIC_ID_PATTERN.test(normalized)) {
    throw new Error("publicId must be 3-128 URL-safe characters.");
  }

  return normalized;
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  let data: unknown = null;

  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw invalidResponseError();
    }
  }

  if (!response.ok) {
    if (isErrorEnvelope(data)) {
      throw new KaspaActionsApiError(data.error.message, {
        code: data.error.code,
        status: response.status,
      });
    }

    throw new KaspaActionsApiError(
      `Kaspa Actions API request failed with status ${response.status}.`,
      {
        code: "HTTP_ERROR",
        status: response.status,
      },
    );
  }

  return data;
}

function resolveFetch(fetchOverride: typeof fetch | undefined) {
  if (fetchOverride) {
    return fetchOverride;
  }

  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }

  throw new Error("A fetch implementation is required.");
}
