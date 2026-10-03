import { z } from "zod";

/**
 * Growth Prompt labels a signup may carry. They name the completed-task surface a
 * visitor came from and never contain personal data. See docs/adr/0005.
 */
export const SIGNUP_SOURCES = ["pay-success", "claim-success"] as const;

export type SignupSource = (typeof SIGNUP_SOURCES)[number];

export const signupSourceSchema = z.enum(SIGNUP_SOURCES);

export const SIGNUP_SOURCE_LABELS: Record<SignupSource, string> = {
  "claim-success": "After claim",
  "pay-success": "After payment",
};

const MAX_SOURCE_LENGTH = 32;

/** Returns the allowlisted label, or null for anything else (arrays, unknown, too long). */
export function parseSignupSource(value: unknown): null | SignupSource {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > MAX_SOURCE_LENGTH) return null;
  return (SIGNUP_SOURCES as readonly string[]).includes(normalized)
    ? (normalized as SignupSource)
    : null;
}

type AuthHrefInput = {
  next: string;
  signupSource?: null | SignupSource;
};

function withSource(base: string, signupSource: null | SignupSource | undefined): string {
  return signupSource ? `${base}&utm_source=${signupSource}` : base;
}

export function buildCreateProfileHref({ next, signupSource }: AuthHrefInput): string {
  return withSource(`/create-profile?next=${encodeURIComponent(next)}`, signupSource);
}

/** Keeps `/sign-in` unchanged when there is nothing to carry over. */
export function buildSignInHref({ next, signupSource }: AuthHrefInput): string {
  if (next === "/dashboard" && !signupSource) return "/sign-in";
  return withSource(`/sign-in?next=${encodeURIComponent(next)}`, signupSource);
}
