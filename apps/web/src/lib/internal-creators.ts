type InternalCreatorEnv = Readonly<Record<string, string | undefined>>;

/**
 * Internal and test accounts that must not count as Activated Creators.
 * `INTERNAL_CREATOR_USERNAMES` is a comma-separated, case-insensitive list.
 */
export function readInternalCreatorUsernames(
  env: InternalCreatorEnv = process.env,
): ReadonlySet<string> {
  return new Set(
    (env.INTERNAL_CREATOR_USERNAMES ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

export function isInternalCreator(
  username: string,
  env: InternalCreatorEnv = process.env,
): boolean {
  return readInternalCreatorUsernames(env).has(username.trim().toLowerCase());
}
