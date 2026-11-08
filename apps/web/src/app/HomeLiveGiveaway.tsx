import Link from "next/link";
import React from "react";

import type { FeaturedGiveaway } from "@/lib/featured-giveaway";

import { V6SlotTime } from "./giveaways/[id]/V6SlotTime";

/** One open giveaway at the top of the home page: prize, spots and close only. */
export function HomeLiveGiveaway({ giveaway }: { giveaway: FeaturedGiveaway }) {
  const spotsLeft = giveaway.participantCap - giveaway.participantCount;
  return (
    <Link
      className="home-live-giveaway"
      href={`/giveaways/${encodeURIComponent(giveaway.publicId)}?from=home`}
    >
      <span className="home-live-giveaway-label">
        <span className="home-live-giveaway-dot" aria-hidden="true" />
        Live giveaway
      </span>
      <span className="home-live-giveaway-body">
        <strong>{giveaway.amountKas} KAS</strong>
        <span>
          {spotsLeft === 1
            ? "1 spot left"
            : `${spotsLeft} of ${giveaway.participantCap} spots left`}{" "}
          · closes <V6SlotTime iso={giveaway.closesAt.toISOString()} />
        </span>
      </span>
      <span className="home-live-giveaway-cta">Join free →</span>
    </Link>
  );
}
