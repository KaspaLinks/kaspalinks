import { createHash } from "node:crypto";

const IP_HASH_PREFIX = "kaspa-actions:ip:";

export function extractClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");

  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first && first.length > 0) {
      return first;
    }
  }

  const realIp = headers.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) {
    return realIp.trim();
  }

  return "unknown";
}

export function hashClientIp(ip: string): string {
  return createHash("sha256").update(`${IP_HASH_PREFIX}${ip}`).digest("hex");
}
