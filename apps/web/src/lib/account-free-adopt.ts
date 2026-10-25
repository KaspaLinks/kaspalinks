import { removeAccountFreeEntries, type AccountFreeEntry } from "./account-free-store";
import { saveClaimableRecord } from "./claimable-store";

export type CreatorSessionHeaders = { token: string; username: string };

/**
 * Moves every link this browser created without an account into the signed-in
 * account. The server checks each private manage token; links it does not accept
 * (deleted, or already moved elsewhere) stay in this browser's list.
 */
export async function moveAccountFreeEntriesIntoAccount(
  session: CreatorSessionHeaders,
  entries: AccountFreeEntry[],
): Promise<{ moved: number; remaining: number }> {
  const headers = {
    "content-type": "application/json",
    "x-creator-token": session.token,
    "x-creator-username": session.username,
  };
  const payments = entries.filter((entry) => entry.kind === "payment");
  const claims = entries.filter((entry) => entry.kind === "claim");
  const moved: AccountFreeEntry[] = [];

  if (payments.length > 0) {
    const response = await fetch("/api/creator/actions/adopt", {
      body: JSON.stringify({
        links: payments.map((entry) => ({
          manageToken: entry.manageToken,
          publicId: entry.publicId,
        })),
      }),
      headers,
      method: "POST",
    });
    if (response.ok) {
      const adopted = new Set(((await response.json()) as { adopted: string[] }).adopted);
      moved.push(...payments.filter((entry) => adopted.has(entry.publicId)));
    }
  }

  if (claims.length > 0) {
    // Keep the claim link in the account's encrypted vault before the server moves
    // the row, so it can never end up in the account without its claim link.
    for (const entry of claims) {
      if (entry.vaultRecord) await saveClaimableRecord(entry.vaultRecord).catch(() => undefined);
    }
    const response = await fetch("/api/creator/claimable-links/adopt", {
      body: JSON.stringify({
        links: claims.map((entry) => ({ linkKey: entry.linkKey, manageToken: entry.manageToken })),
      }),
      headers,
      method: "POST",
    });
    if (response.ok) {
      const adopted = new Set(((await response.json()) as { adopted: string[] }).adopted);
      moved.push(...claims.filter((entry) => adopted.has(entry.linkKey)));
    }
  }

  removeAccountFreeEntries(moved);
  return { moved: moved.length, remaining: entries.length - moved.length };
}
