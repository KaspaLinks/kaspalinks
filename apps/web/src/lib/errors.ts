import { stringifyWithBigInts } from "@kaspa-actions/kaspa";

export const ErrorCodes = {
  ACTION_DISABLED: "ACTION_DISABLED",
  ACTION_EXPIRED: "ACTION_EXPIRED",
  ADMIN_DISABLED: "ADMIN_DISABLED",
  ADMIN_TOKEN_INVALID: "ADMIN_TOKEN_INVALID",
  ADMIN_TOKEN_REQUIRED: "ADMIN_TOKEN_REQUIRED",
  CHAIN_LOOKUP_DISABLED: "CHAIN_LOOKUP_DISABLED",
  CREATOR_SIGNUP_DISABLED: "CREATOR_SIGNUP_DISABLED",
  CREATOR_TOKEN_INVALID: "CREATOR_TOKEN_INVALID",
  CREATOR_TOKEN_REQUIRED: "CREATOR_TOKEN_REQUIRED",
  GOAL_CLOSED: "GOAL_CLOSED",
  INVALID_BODY: "INVALID_BODY",
  INVALID_STATE: "INVALID_STATE",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  MOCK_CONFIRM_DISABLED: "MOCK_CONFIRM_DISABLED",
  NOT_FOUND: "NOT_FOUND",
  PRICE_UNAVAILABLE: "PRICE_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  SERVER_ERROR: "SERVER_ERROR",
  SLUG_TAKEN: "SLUG_TAKEN",
  TOCCATA_LAB_DISABLED: "TOCCATA_LAB_DISABLED",
  TOCCATA_SDK_UNAVAILABLE: "TOCCATA_SDK_UNAVAILABLE",
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
  USERNAME_TAKEN: "USERNAME_TAKEN",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export type ApiErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
  };
};

export function apiError(
  code: ErrorCode,
  message: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return new Response(stringifyWithBigInts(body), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
    status,
  });
}

export function apiJson(body: unknown, status = 200): Response {
  return new Response(stringifyWithBigInts(body), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
    status,
  });
}

export function apiMethodNotAllowed(allowedMethods: string[]): Response {
  const allow = allowedMethods.join(", ");

  return apiError(ErrorCodes.METHOD_NOT_ALLOWED, `Allowed methods: ${allow}.`, 405, {
    Allow: allow,
  });
}
