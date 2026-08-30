import { ApplicationError } from "@kaspa-actions/application";

import { apiError, ErrorCodes } from "./errors";

export function applicationErrorResponse(error: unknown): Response | null {
  if (!(error instanceof ApplicationError)) return null;
  const code =
    error.code === "ACTION_LIMIT_REACHED" || error.code === "CONNECT_RATE_LIMITED"
      ? ErrorCodes.RATE_LIMITED
      : error.code.endsWith("NOT_FOUND")
        ? ErrorCodes.NOT_FOUND
        : error.status === 409
          ? ErrorCodes.INVALID_STATE
          : error.status === 403
            ? ErrorCodes.ACTION_DISABLED
            : ErrorCodes.INVALID_BODY;
  return apiError(code, error.message, error.status);
}
