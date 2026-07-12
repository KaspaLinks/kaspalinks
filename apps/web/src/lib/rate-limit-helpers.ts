import { consumeRateLimit, retryAfterSeconds, type RateLimitResult } from "./rate-limit";
import { apiError, ErrorCodes } from "./errors";

export const RateBuckets = {
  ADMIN_MUTATION: "admin.mutation",
  CREATOR_ACTION_CREATE: "creator.action.create",
  CREATOR_LOGIN: "creator.login",
  CREATOR_PROFILE_DELETE: "creator.profile.delete",
  CREATOR_PROFILE_UPDATE: "creator.profile.update",
  CREATOR_SIGNUP: "creator.signup",
  MOCK_CONFIRM: "mock.confirm",
  PAYMENT_REQUEST_CREATE: "payment-request.create",
  PAYMENT_REQUEST_STATUS: "payment-request.status",
  PAYMENT_REQUEST_UPDATE: "payment-request.update",
  QR_DOWNLOAD: "qr.download",
  TOCCATA_LAB_DAG_INFO: "toccata-lab.dag-info",
  TOCCATA_LAB_CLAIMABLE_BROADCAST: "toccata-lab.claimable-broadcast",
  TOCCATA_LAB_BATCH_SCRIPT: "toccata-lab.batch-script",
  TOCCATA_LAB_CLAIMABLE_SCRIPT: "toccata-lab.claimable-script",
  TOCCATA_LAB_CLAIMABLE_SPEND: "toccata-lab.claimable-spend",
  TOCCATA_LAB_FUNDING_STATUS: "toccata-lab.funding-status",
  TOCCATA_LAB_INTENT: "toccata-lab.intent",
  TOCCATA_LAB_PSKT_SMOKE: "toccata-lab.pskt-smoke",
  TOCCATA_LAB_QR: "toccata-lab.qr",
  TOCCATA_LAB_SAFE_JSON_SMOKE: "toccata-lab.safe-json-smoke",
} as const;

export const RateLimits = {
  [RateBuckets.ADMIN_MUTATION]: { limit: 30, windowMs: 60_000 },
  [RateBuckets.CREATOR_ACTION_CREATE]: { limit: 20, windowMs: 60_000 },
  [RateBuckets.CREATOR_LOGIN]: { limit: 10, windowMs: 60_000 },
  [RateBuckets.CREATOR_PROFILE_DELETE]: { limit: 5, windowMs: 60_000 },
  // Profile edits are interactive (creator clicks Save in the dashboard
  // settings panel) — allow rapid iteration when adjusting bio text but
  // still cap at the same generous bucket used for action mutations.
  [RateBuckets.CREATOR_PROFILE_UPDATE]: { limit: 30, windowMs: 60_000 },
  [RateBuckets.CREATOR_SIGNUP]: { limit: 5, windowMs: 60 * 60_000 },
  [RateBuckets.MOCK_CONFIRM]: { limit: 30, windowMs: 60_000 },
  [RateBuckets.PAYMENT_REQUEST_CREATE]: { limit: 20, windowMs: 60_000 },
  [RateBuckets.PAYMENT_REQUEST_STATUS]: { limit: 120, windowMs: 60_000 },
  [RateBuckets.PAYMENT_REQUEST_UPDATE]: { limit: 30, windowMs: 60_000 },
  [RateBuckets.QR_DOWNLOAD]: { limit: 60, windowMs: 60_000 },
  [RateBuckets.TOCCATA_LAB_CLAIMABLE_BROADCAST]: { limit: 8, windowMs: 60_000 },
  [RateBuckets.TOCCATA_LAB_BATCH_SCRIPT]: { limit: 3, windowMs: 60_000 },
  [RateBuckets.TOCCATA_LAB_CLAIMABLE_SCRIPT]: { limit: 20, windowMs: 60_000 },
  [RateBuckets.TOCCATA_LAB_CLAIMABLE_SPEND]: { limit: 12, windowMs: 60_000 },
  [RateBuckets.TOCCATA_LAB_DAG_INFO]: { limit: 20, windowMs: 60_000 },
  [RateBuckets.TOCCATA_LAB_FUNDING_STATUS]: { limit: 60, windowMs: 60_000 },
  [RateBuckets.TOCCATA_LAB_INTENT]: { limit: 20, windowMs: 60_000 },
  [RateBuckets.TOCCATA_LAB_PSKT_SMOKE]: { limit: 20, windowMs: 60_000 },
  [RateBuckets.TOCCATA_LAB_QR]: { limit: 60, windowMs: 60_000 },
  [RateBuckets.TOCCATA_LAB_SAFE_JSON_SMOKE]: { limit: 20, windowMs: 60_000 },
} as const;

export function enforceRateLimit(
  bucket: keyof typeof RateLimits,
  identifier: string,
): { allowed: true; result: RateLimitResult } | { allowed: false; response: Response } {
  const config = RateLimits[bucket];
  const result = consumeRateLimit({
    bucket,
    identifier,
    limit: config.limit,
    windowMs: config.windowMs,
  });

  if (result.allowed) {
    return { allowed: true, result };
  }

  return {
    allowed: false,
    response: apiError(ErrorCodes.RATE_LIMITED, "Too many requests. Please retry later.", 429, {
      "Retry-After": String(retryAfterSeconds(result.resetAt)),
    }),
  };
}
