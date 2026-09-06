import { parseKaspaAmountToSompi } from "@kaspa-actions/kaspa";

export type TelegramCommand =
  | { kind: "public_giveaway" | "watch_giveaway"; publicId: string }
  | { kind: "stop_giveaway_alerts" }
  | { kind: "connect"; code: string }
  | { kind: "disconnect" | "giveaways" | "help" | "links" | "payments" | "start" | "stats" }
  | {
      amountKas: string;
      entryWindowSeconds: number;
      kind: "prepare_giveaway";
      title: string;
    }
  | {
      amountKas?: string;
      kind: "create_action";
      title: string;
      type: "kaspa.donation" | "kaspa.goal" | "kaspa.invoice" | "kaspa.tip" | "kaspa.transfer";
    }
  | { kind: "unknown"; command: string };

export class TelegramCommandError extends Error {}

function normalizedAmount(raw: string): null | string {
  const normalized = raw.replace(",", ".");
  if (!/^\d+(?:\.\d{1,8})?$/.test(normalized)) return null;
  try {
    parseKaspaAmountToSompi(normalized);
  } catch {
    throw new TelegramCommandError("Use a positive KAS amount with at most 8 decimal places.");
  }
  return normalized;
}

function parseGiveawayDuration(raw: string): number {
  const match = /^(\d+)([mhd])$/i.exec(raw);
  if (!match) {
    throw new TelegramCommandError("Use a duration such as 30m, 24h, or 7d.");
  }
  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const multiplier = unit === "d" ? 86_400 : unit === "h" ? 3_600 : 60;
  const seconds = value * multiplier;
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 7 * 86_400) {
    throw new TelegramCommandError("Giveaway duration must be between 1 minute and 7 days.");
  }
  return seconds;
}

export function slugifyAgentTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (slug.length >= 3) return slug;
  return `link-${slug || "kas"}`.slice(0, 64);
}

export function parseTelegramCommand(text: string): TelegramCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const firstSpace = trimmed.indexOf(" ");
  const rawName = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).slice(1);
  const command = rawName.split("@")[0]?.toLowerCase() ?? "";
  const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

  if (command === "stop") return { kind: "stop_giveaway_alerts" };
  if (command === "start") {
    const publicLink = /^(g|watch)_([a-zA-Z0-9_-]{1,48})$/.exec(rest);
    if (publicLink)
      return {
        kind: publicLink[1] === "g" ? "public_giveaway" : "watch_giveaway",
        publicId: publicLink[2]!,
      };
  }
  if (command === "connect") {
    if (!rest) throw new TelegramCommandError("Use /connect followed by the connection code.");
    return { code: rest, kind: "connect" };
  }
  if (command === "start") {
    return rest ? { code: rest, kind: "connect" } : { kind: "start" };
  }
  if (["disconnect", "giveaways", "help", "links", "payments", "stats"].includes(command)) {
    return {
      kind: command as "disconnect" | "giveaways" | "help" | "links" | "payments" | "stats",
    };
  }

  if (command === "giveaway") {
    const [rawAmount = "", rawDuration = "", ...titleParts] = rest.split(/\s+/);
    const amountKas = normalizedAmount(rawAmount);
    if (!amountKas) {
      throw new TelegramCommandError("Use /giveaway <KAS> <duration> <title>.");
    }
    const entryWindowSeconds = parseGiveawayDuration(rawDuration);
    const title = titleParts.join(" ").trim();
    if (!title) throw new TelegramCommandError("Giveaway title is required after the duration.");
    if (title.length > 80)
      throw new TelegramCommandError("Title must be 80 characters or shorter.");
    return { amountKas, entryWindowSeconds, kind: "prepare_giveaway", title };
  }

  const types = {
    donation: "kaspa.donation",
    goal: "kaspa.goal",
    invoice: "kaspa.invoice",
    link: "kaspa.transfer",
    tip: "kaspa.tip",
  } as const;
  const type = types[command as keyof typeof types];
  if (!type) return { command, kind: "unknown" };
  if (!rest) throw new TelegramCommandError(`/${command} needs a title.`);

  const [first = "", ...remaining] = rest.split(/\s+/);
  const amountKas = normalizedAmount(first);
  if (!amountKas && /^\d/.test(first)) {
    throw new TelegramCommandError("Use a positive KAS amount with at most 8 decimal places.");
  }
  const requiresAmount =
    type === "kaspa.transfer" || type === "kaspa.invoice" || type === "kaspa.goal";
  if (requiresAmount && !amountKas) {
    throw new TelegramCommandError(`/${command} needs a KAS amount before the title.`);
  }
  const title = amountKas ? remaining.join(" ").trim() : rest;
  if (!title) throw new TelegramCommandError(`/${command} needs a title after the amount.`);
  if (title.length > 80) throw new TelegramCommandError("Title must be 80 characters or shorter.");

  return { ...(amountKas ? { amountKas } : {}), kind: "create_action", title, type };
}
