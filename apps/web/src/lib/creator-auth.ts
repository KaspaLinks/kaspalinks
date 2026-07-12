import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { Creator } from "@kaspa-actions/db";

import { normalizeSocialLinksRecord } from "./social-links";

const CREATOR_TOKEN_PREFIX = "ka_creator_";
const TOKEN_BYTES = 32;
const DEFAULT_DAILY_ACTION_LIMIT = 50;

export type SafeCreator = Pick<
  Creator,
  "bio" | "createdAt" | "displayName" | "id" | "socialLinks" | "tipActionId" | "username"
>;

export function generateCreatorToken(): string {
  return `${CREATOR_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function hashCreatorToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyCreatorToken(token: string, expectedHash: string): boolean {
  const presented = Buffer.from(hashCreatorToken(token), "hex");
  let expected: Buffer;

  try {
    expected = Buffer.from(expectedHash, "hex");
  } catch {
    return false;
  }

  if (presented.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(presented, expected);
}

export function readBearerToken(headerValue: null | string): null | string {
  if (!headerValue?.startsWith("Bearer ")) {
    return null;
  }

  const token = headerValue.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function readCreatorToken(headers: Headers): null | string {
  const creatorToken = headers.get("x-creator-token")?.trim();
  if (creatorToken) {
    return creatorToken;
  }

  return readBearerToken(headers.get("authorization"));
}

export function isCreatorSignupEnabled(
  value = process.env.CREATOR_SIGNUP_ENABLED,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  if (value === undefined || value === null || value.trim().length === 0) {
    return nodeEnv !== "production";
  }

  return value.trim().toLowerCase() === "true";
}

export function readCreatorActionDailyLimit(
  value = process.env.CREATOR_ACTION_DAILY_LIMIT,
): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DAILY_ACTION_LIMIT;
  }

  return Math.min(parsed, 500);
}

export function rollingDailyWindowStart(now = new Date()): Date {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

export function serializeSafeCreator(creator: SafeCreator) {
  const socialLinks = normalizeSocialLinksRecord(creator.socialLinks);

  return {
    bio: creator.bio,
    createdAt: creator.createdAt.toISOString(),
    displayName: creator.displayName,
    id: creator.id,
    socialLinks: socialLinks.ok ? socialLinks.value : null,
    tipActionId: creator.tipActionId,
    username: creator.username,
  };
}
