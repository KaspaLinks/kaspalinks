import { z } from "zod";

import { GIVEAWAY_TURNSTILE_ACTION } from "./turnstile-shared";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5_000;

const siteverifyResponseSchema = z.object({
  action: z.string().optional(),
  hostname: z.string().optional(),
  success: z.boolean(),
});

export type TurnstileVerificationResult =
  | { ok: true }
  | { kind: "invalid" | "unavailable"; ok: false };

export function getGiveawayTurnstileClientConfig(): {
  required: boolean;
  siteKey: string;
} {
  return {
    required: process.env.GIVEAWAY_TURNSTILE_ENABLED === "true",
    siteKey: process.env.TURNSTILE_SITE_KEY?.trim() ?? "",
  };
}

export async function verifyGiveawayTurnstile(input: {
  remoteIp?: string;
  token?: string;
}): Promise<TurnstileVerificationResult> {
  if (process.env.GIVEAWAY_TURNSTILE_ENABLED !== "true") return { ok: true };

  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  const token = input.token?.trim() ?? "";
  if (!secretKey) return { kind: "unavailable", ok: false };
  if (!token || token.length > 2048) return { kind: "invalid", ok: false };

  const body = new URLSearchParams({ response: token, secret: secretKey });
  if (input.remoteIp && input.remoteIp !== "unknown") body.set("remoteip", input.remoteIp);

  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, {
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch {
    return { kind: "unavailable", ok: false };
  }
  if (!response.ok) return { kind: "unavailable", ok: false };

  let rawResult: unknown;
  try {
    rawResult = await response.json();
  } catch {
    return { kind: "unavailable", ok: false };
  }
  const parsed = siteverifyResponseSchema.safeParse(rawResult);
  if (!parsed.success) return { kind: "unavailable", ok: false };
  if (!parsed.data.success || parsed.data.action !== GIVEAWAY_TURNSTILE_ACTION) {
    return { kind: "invalid", ok: false };
  }

  const expectedHostname = getExpectedHostname();
  if (!parsed.data.hostname || parsed.data.hostname.toLowerCase() !== expectedHostname) {
    return { kind: "invalid", ok: false };
  }

  return { ok: true };
}

function getExpectedHostname(): string {
  const configured = process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim().toLowerCase();
  if (configured) return configured;

  try {
    return new URL(
      process.env.NEXT_PUBLIC_APP_URL ?? "https://kaspalinks.com",
    ).hostname.toLowerCase();
  } catch {
    return "kaspalinks.com";
  }
}
