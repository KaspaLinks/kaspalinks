import { openSecret, sealSecret } from "./browser-seal";

// The guest workspace behind giveaways on the website without a profile. Its
// token is sealed like the other secrets of links without an account; values
// stored in plain text before are sealed on their next read.

export const GUEST_STORAGE_KEY = "kaspalinks.giveawayGuest";

export type GuestIdentity = { token: string; username: string };

type StoredGuest = { sealedToken: string; username: string };

function readRaw(): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(GUEST_STORAGE_KEY) ?? "null") as unknown;
  } catch {
    return null;
  }
}

function hasString(value: unknown, field: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[field] === "string"
  );
}

/** False when this browser cannot keep it sealed; then nothing is written. */
export async function storeGuest(identity: GuestIdentity): Promise<boolean> {
  const sealedToken = await sealSecret(identity.token);
  if (!sealedToken) return false;
  try {
    const stored: StoredGuest = { sealedToken, username: identity.username };
    window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

export async function readStoredGuest(): Promise<GuestIdentity | null> {
  const value = readRaw();
  if (!hasString(value, "username")) return null;
  const { username } = value as { username: string };
  if (hasString(value, "sealedToken")) {
    const token = await openSecret((value as StoredGuest).sealedToken);
    return token ? { token, username } : null;
  }
  if (hasString(value, "token")) {
    // Written before sealing: use it and seal it now.
    const identity = { token: (value as GuestIdentity).token, username };
    if (!(await storeGuest(identity))) {
      try {
        window.localStorage.removeItem(GUEST_STORAGE_KEY);
      } catch {
        // Nothing more to do.
      }
    }
    return identity;
  }
  return null;
}
