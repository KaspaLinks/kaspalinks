import { removeAccountFreeEntries, type AccountFreeEntry } from "./account-free-store";

// A claim code is only worth keeping while its link can still be claimed. Once
// the link is claimed, returned or gone, this browser forgets it.

const FINISHED_STATUSES = new Set(["claimed", "refunded", "spent_unknown"]);

export type FetchClaimStatuses = (linkKeys: string[]) => Promise<null | Record<string, string>>;

async function fetchClaimStatuses(linkKeys: string[]): Promise<null | Record<string, string>> {
  try {
    const response = await fetch("/api/claimable-links/status", {
      body: JSON.stringify({ linkKeys }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { statuses?: Record<string, string> };
    return body.statuses ?? null;
  } catch {
    return null;
  }
}

/** Removes finished claim links from this browser; returns how many. */
export async function forgetFinishedClaimLinks(
  entries: AccountFreeEntry[],
  fetchStatuses: FetchClaimStatuses = fetchClaimStatuses,
): Promise<number> {
  const claims = entries.filter((entry) => entry.kind === "claim");
  if (claims.length === 0) return 0;
  const statuses = await fetchStatuses(claims.slice(0, 100).map((entry) => entry.linkKey));
  // On any lookup failure keep everything: forgetting a live claim code is worse.
  if (!statuses) return 0;
  const finished = claims.slice(0, 100).filter((entry) => {
    const status = statuses[entry.linkKey];
    return status === undefined || FINISHED_STATUSES.has(status);
  });
  if (finished.length > 0) removeAccountFreeEntries(finished);
  return finished.length;
}
