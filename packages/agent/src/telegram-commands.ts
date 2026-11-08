import { parseKaspaAmountToSompi } from "@kaspa-actions/kaspa";

export type TelegramCommand =
  | { kind: "public_giveaway" | "watch_giveaway"; publicId: string }
  | { kind: "stop_giveaway_alerts" }
  | { kind: "connect"; code: string }
  | { chatId: string; kind: "group_setup" }
  | { kind: "disconnect" | "giveaways" | "help" | "links" | "payments" | "start" | "stats" }
  | { amountKas: string; kind: "prepare_giveaway"; title: string }
  | { amountKas: string; kind: "prepare_claim"; title: string }
  | { kind: "show_wallet" }
  | { address: string; kind: "set_wallet" }
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

// Usage stats keep only a coarse label from these fixed lists, never the text
// someone typed, so the stored value can't carry titles, addresses or names.
const COUNTED_COMMANDS = new Set([
  "claim",
  "connect",
  "disconnect",
  "donation",
  "giveaway",
  "giveaways",
  "goal",
  "help",
  "invoice",
  "link",
  "links",
  "payments",
  "start",
  "stats",
  "stop",
  "tip",
  "wallet",
]);
const COUNTED_BUTTONS = new Set(["draft", "menu", "notify", "watch"]);

/** The stats label of one bot update, e.g. "/claim", "button:menu" or "text". */
export function telegramUpdateLabel(input: {
  callbackData?: null | string;
  text?: null | string;
}): null | string {
  if (input.callbackData !== undefined && input.callbackData !== null) {
    const prefix = input.callbackData.split(":")[0] ?? "";
    return COUNTED_BUTTONS.has(prefix) ? `button:${prefix}` : "button:other";
  }
  const text = input.text?.trim() ?? "";
  if (!text) return null;
  if (!text.startsWith("/")) return "text";
  const name = text.slice(1).split(/\s/)[0]?.split("@")[0]?.toLowerCase() ?? "";
  return COUNTED_COMMANDS.has(name) ? `/${name}` : "/other";
}

// Group chat ids are negative; a start payload allows only [A-Za-z0-9_-], so the
// minus sign becomes "m". The id is not a secret: setting up a giveaway for the
// group still requires the person to be one of its admins.
export function groupStartPayload(chatId: string): string {
  if (!/^-?\d{1,20}$/.test(chatId)) throw new Error("Invalid Telegram chat id.");
  return `grp_${chatId.replace(/^-/, "m")}`;
}

function parseGroupStartPayload(payload: string): null | string {
  const match = /^grp_(m?)(\d{1,20})$/.exec(payload);
  return match ? `${match[1] ? "-" : ""}${match[2]}` : null;
}

export type TelegramGroupCommand = { kind: "giveaway" } | { kind: "help" };

/**
 * Commands the bot answers in a group. Everything else stays unanswered so the
 * bot never talks over a conversation; a command addressed to another bot
 * (/giveaway@OtherBot) is ignored too.
 */
export function parseTelegramGroupCommand(
  text: string,
  botUsername: string,
): null | TelegramGroupCommand {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const [name = "", target] = (trimmed.split(/\s/)[0] ?? "").slice(1).split("@");
  if (target !== undefined && target.toLowerCase() !== botUsername.replace(/^@/, "").toLowerCase())
    return null;
  const command = name.toLowerCase();
  if (command === "giveaway") return { kind: "giveaway" };
  if (command === "start" || command === "help") return { kind: "help" };
  return null;
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
    const group = parseGroupStartPayload(rest);
    if (group) return { chatId: group, kind: "group_setup" };
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
    const [rawAmount = "", ...titleParts] = rest.split(/\s+/);
    const amountKas = normalizedAmount(rawAmount);
    if (!amountKas) {
      throw new TelegramCommandError("Use /giveaway <KAS> <title>.");
    }
    // Any prize from 0.2 KAS; the Mini App and the server check it again.
    if (parseKaspaAmountToSompi(amountKas) < 20_000_000n) {
      throw new TelegramCommandError("Giveaway prize must be at least 0.2 KAS.");
    }
    // Giveaways end at fixed draw times chosen in the Mini App. An old-style
    // duration would otherwise silently become the start of the title.
    if (/^\d+[mhd]$/i.test(titleParts[0] ?? "")) {
      throw new TelegramCommandError(
        "Giveaways now end at fixed draw times. Use /giveaway <KAS> <title> and pick the time in the app.",
      );
    }
    const title = titleParts.join(" ").trim();
    if (!title) throw new TelegramCommandError("Giveaway title is required after the prize.");
    if (title.length > 80)
      throw new TelegramCommandError("Title must be 80 characters or shorter.");
    return { amountKas, kind: "prepare_giveaway", title };
  }

  if (command === "wallet") {
    // Phones capitalize the first letter; Kaspa addresses are lowercase.
    return rest ? { address: rest.toLowerCase(), kind: "set_wallet" } : { kind: "show_wallet" };
  }

  if (command === "claim") {
    const [rawAmount = "", ...titleParts] = rest.split(/\s+/);
    const amountKas = normalizedAmount(rawAmount);
    if (!amountKas) throw new TelegramCommandError("Use /claim <KAS> [title].");
    const title = titleParts.join(" ").trim();
    if (title.length > 80)
      throw new TelegramCommandError("Title must be 80 characters or shorter.");
    return { amountKas, kind: "prepare_claim", title };
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
