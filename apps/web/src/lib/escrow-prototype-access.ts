type EscrowPrototypeEnv = Readonly<Record<string, string | undefined>>;

/**
 * Escrow links are a mock-data prototype. The routes exist in local development
 * by default and stay hidden in production unless explicitly enabled.
 */
export function isEscrowPrototypeEnabled(env: EscrowPrototypeEnv = process.env): boolean {
  const flag = env.ESCROW_LINKS_PROTOTYPE_ENABLED;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return env.NODE_ENV !== "production";
}

/**
 * Even with the routes enabled, only allowlisted creators see the prototype.
 * The username must come from a verified creator session, never from input.
 */
export function isEscrowPrototypeCreator(
  username: string,
  env: EscrowPrototypeEnv = process.env,
): boolean {
  const allowlist = (env.ESCROW_LINKS_PROTOTYPE_CREATORS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return allowlist.includes(username.trim().toLowerCase());
}
