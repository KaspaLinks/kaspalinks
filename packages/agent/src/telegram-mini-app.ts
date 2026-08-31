import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_MAX_AGE_SECONDS = 60 * 60;
const MAX_FUTURE_SKEW_SECONDS = 60;
const MAX_INIT_DATA_LENGTH = 8_192;

export type TelegramMiniAppIdentity = {
  authDate: Date;
  queryId: null | string;
  userId: string;
};

export type TelegramMiniAppValidation =
  | { identity: TelegramMiniAppIdentity; ok: true }
  | {
      error: "EXPIRED" | "INVALID_AUTH_DATE" | "INVALID_SIGNATURE" | "INVALID_USER" | "MALFORMED";
      ok: false;
    };

export function validateTelegramMiniAppInitData(
  rawInitData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; now?: Date } = {},
): TelegramMiniAppValidation {
  if (!rawInitData || rawInitData.length > MAX_INIT_DATA_LENGTH || !botToken.trim()) {
    return { error: "MALFORMED", ok: false };
  }

  const params = new URLSearchParams(rawInitData);
  const seen = new Set<string>();
  for (const [key] of params) {
    if (seen.has(key)) return { error: "MALFORMED", ok: false };
    seen.add(key);
  }

  const presentedHash = params.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/i.test(presentedHash)) {
    return { error: "INVALID_SIGNATURE", ok: false };
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const presented = Buffer.from(presentedHash, "hex");
  if (presented.length !== expectedHash.length || !timingSafeEqual(presented, expectedHash)) {
    return { error: "INVALID_SIGNATURE", ok: false };
  }

  const authDateSeconds = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(authDateSeconds) || authDateSeconds <= 0) {
    return { error: "INVALID_AUTH_DATE", ok: false };
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  if (
    authDateSeconds > nowSeconds + MAX_FUTURE_SKEW_SECONDS ||
    nowSeconds - authDateSeconds > maxAgeSeconds
  ) {
    return { error: "EXPIRED", ok: false };
  }

  let user: unknown;
  try {
    user = JSON.parse(params.get("user") ?? "");
  } catch {
    return { error: "INVALID_USER", ok: false };
  }
  if (
    typeof user !== "object" ||
    user === null ||
    !("id" in user) ||
    (typeof user.id !== "number" && typeof user.id !== "string")
  ) {
    return { error: "INVALID_USER", ok: false };
  }
  const userId = String(user.id);
  if (!/^-?[0-9]+$/.test(userId)) return { error: "INVALID_USER", ok: false };

  return {
    identity: {
      authDate: new Date(authDateSeconds * 1_000),
      queryId: params.get("query_id"),
      userId,
    },
    ok: true,
  };
}
