"use client";

import { useState } from "react";
import Link from "next/link";

export type SupporterWallEntry = {
  actionHref: string;
  actionTitle: string;
  amountKas: null | string;
  dateLabel: string;
  id: string;
  message: null | string;
  supporterName: string;
  typeLabel: string;
};

type SupporterWallProps = {
  entries: SupporterWallEntry[];
  initialNextCursor: null | string;
  username: string;
};

export function SupporterWall({
  entries: initialEntries,
  initialNextCursor,
  username,
}: SupporterWallProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<null | string>(null);

  async function loadMoreSupporters() {
    if (!nextCursor || isLoadingMore) return;

    setIsLoadingMore(true);
    setLoadError(null);

    try {
      const params = new URLSearchParams({ cursor: nextCursor });
      const response = await fetch(
        `/api/profiles/${encodeURIComponent(username)}/supporters?${params.toString()}`,
        {
          headers: { Accept: "application/json" },
        },
      );

      if (!response.ok) {
        throw new Error("Could not load more supporters.");
      }

      const body = (await response.json()) as {
        nextCursor?: null | string;
        supporters?: SupporterWallEntry[];
      };
      const nextSupporters = body.supporters;

      if (!Array.isArray(nextSupporters)) {
        throw new Error("Could not load more supporters.");
      }

      setEntries((current) => [...current, ...nextSupporters]);
      setNextCursor(body.nextCursor ?? null);
    } catch {
      setLoadError("Could not load more supporters. Please try again.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <section className="profile-supporter-wall" aria-labelledby="supporter-wall-heading">
      <div className="profile-section-heading">
        <div>
          <span className="profile-section-kicker">Supporter wall</span>
          <h2 id="supporter-wall-heading">Recent public support</h2>
        </div>
      </div>
      <ul className="profile-supporter-wall-list">
        {entries.map((entry) => (
          <li className="profile-supporter-wall-card" key={entry.id}>
            <div className="profile-supporter-wall-card__top">
              <div>
                <strong>{entry.supporterName}</strong>
                <span>{entry.dateLabel}</span>
              </div>
              {entry.amountKas ? (
                <span className="profile-supporter-wall-card__amount">{entry.amountKas} KAS</span>
              ) : (
                <span className="profile-supporter-wall-card__amount">Paid</span>
              )}
            </div>
            {entry.message ? (
              <p className="profile-supporter-wall-card__message">&ldquo;{entry.message}&rdquo;</p>
            ) : null}
            <Link className="profile-supporter-wall-card__link" href={entry.actionHref}>
              {entry.typeLabel} · {entry.actionTitle}
            </Link>
          </li>
        ))}
      </ul>
      {loadError ? <p className="profile-supporter-wall-error">{loadError}</p> : null}
      {nextCursor ? (
        <button
          className="profile-supporter-wall-toggle"
          disabled={isLoadingMore}
          onClick={() => {
            void loadMoreSupporters();
          }}
          type="button"
        >
          {isLoadingMore ? "Loading supporters..." : "Load more supporters"}
        </button>
      ) : null}
    </section>
  );
}
