"use client";

import React, { useEffect, useState } from "react";

import { formatGiveawayV6SlotLocal, formatGiveawayV6SlotUtc } from "@/lib/giveaway-v6-slots";

/**
 * The server does not know the viewer's time zone, so it renders the UTC time
 * and the browser adds the local one after hydration.
 */
export function V6SlotTime({ iso }: { iso: string }) {
  const [local, setLocal] = useState<null | string>(null);
  useEffect(() => {
    setLocal(formatGiveawayV6SlotLocal(new Date(iso), new Date()));
  }, [iso]);
  const date = new Date(iso);
  const utc = formatGiveawayV6SlotUtc(date);
  const utcDay = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
  return <time dateTime={iso}>{local ? `${local} (${utc})` : `${utcDay}, ${utc}`}</time>;
}
