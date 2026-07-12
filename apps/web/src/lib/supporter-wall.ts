export const SUPPORTER_WALL_INITIAL_COUNT = 6;
export const SUPPORTER_WALL_PAGE_SIZE = 20;

export type SupporterWallCursor = {
  confirmedAt: Date;
  id: string;
};

export function profileActionTypeLabel(type: string): string {
  switch (type) {
    case "KASPA_TIP":
    case "kaspa.tip":
      return "Tip";
    case "KASPA_DONATION":
    case "kaspa.donation":
      return "Donation";
    case "KASPA_INVOICE":
    case "kaspa.invoice":
      return "Invoice";
    case "KASPA_TRANSFER":
    case "kaspa.transfer":
      return "Transfer";
    case "KASPA_GOAL":
    case "kaspa.goal":
      return "Goal";
    default:
      return type.replace(/^kaspa\./, "");
  }
}

export function formatSupporterWallDate(value: null | Date | string): string {
  if (!value) return "Recently";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function encodeSupporterWallCursor(value: {
  confirmedAt: Date | string;
  id: string;
}): string {
  const confirmedAt =
    value.confirmedAt instanceof Date ? value.confirmedAt.toISOString() : value.confirmedAt;

  return `${confirmedAt}|${value.id}`;
}

export function decodeSupporterWallCursor(value: string): null | SupporterWallCursor {
  const separatorIndex = value.lastIndexOf("|");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return null;
  }

  const confirmedAt = new Date(value.slice(0, separatorIndex));
  const id = value.slice(separatorIndex + 1).trim();

  if (Number.isNaN(confirmedAt.getTime()) || id.length === 0) {
    return null;
  }

  return { confirmedAt, id };
}
