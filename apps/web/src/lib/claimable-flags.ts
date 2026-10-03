type ClaimableFlagEnv = Readonly<Record<string, string | undefined>>;

function readFlag(value: string | undefined, nodeEnv: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return nodeEnv !== "production";
  return value.trim().toLowerCase() === "true";
}

/**
 * New single claimable links use the keyless auto-return script (v2, docs/adr/0007).
 * On in development, off in production unless set explicitly.
 */
export function isClaimableAutoReturnEnabled(env: ClaimableFlagEnv = process.env): boolean {
  return readFlag(env.CLAIMABLE_AUTO_RETURN_ENABLED, env.NODE_ENV);
}

/** Single claimable links can be created without a KaspaLinks account (requires v2). */
export function isClaimableAnonymousEnabled(env: ClaimableFlagEnv = process.env): boolean {
  return (
    isClaimableAutoReturnEnabled(env) && readFlag(env.CLAIMABLE_ANONYMOUS_ENABLED, env.NODE_ENV)
  );
}
