import { groupStartPayload } from "./telegram-commands.ts";
import { telegramGiveawayIdSchema, type V6GiveawayShareInput } from "./telegram-giveaways.ts";
import type { TelegramInlineButton } from "./telegram-types.ts";

// Messages for Telegram groups. Telegram allows only URL buttons in groups, so
// every button here is a plain link: setup continues in the private chat with
// the bot, entry on the giveaway page.

type BotMessage = { buttons?: TelegramInlineButton[][]; text: string };

/** Telegram's sender id for admins who post anonymously as the group. */
export const TELEGRAM_ANONYMOUS_ADMIN_ID = "1087968824";

const GROUP_TITLE_MAX = 64;

function groupName(title: null | string | undefined): string {
  const trimmed = title?.trim();
  if (!trimmed) return "this group";
  return trimmed.length > GROUP_TITLE_MAX ? `${trimmed.slice(0, GROUP_TITLE_MAX - 1)}…` : trimmed;
}

function utc(date: Date): string {
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function shortAddress(address: string): string {
  const [prefix, body] = address.includes(":") ? address.split(":", 2) : ["", address];
  if (!body || body.length <= 16) return address;
  return `${prefix ? `${prefix}:` : ""}${body.slice(0, 6)}…${body.slice(-6)}`;
}

function giveawayUrl(appUrl: string, publicId: string): string {
  const id = telegramGiveawayIdSchema.parse(publicId);
  return `${new URL(appUrl).origin}/giveaways/${id}?from=tg-group`;
}

export function groupWelcomeText(): string {
  return [
    "👋 Thanks for adding Kaspa Links!",
    "",
    "Admins: send /giveaway to run a KAS giveaway for this group. Entry is free. I post it here, remind everyone before entries close and announce the winner.",
    "",
    "The winner is drawn on Kaspa and paid automatically. Kaspa Links never holds the prize.",
  ].join("\n");
}

export const groupAdminOnlyText = "Only group admins can start a giveaway here.";
export const groupAnonymousAdminText =
  "I can't check anonymous admins. Turn off “Remain anonymous” for a moment and send /giveaway again.";

/** The group's answer to /giveaway from an admin: continue in the private chat. */
export function groupSetupMessage(input: {
  botUsername: string;
  chatId: string;
  title?: null | string;
}): BotMessage {
  const bot = input.botUsername.replace(/^@/, "");
  return {
    text: [
      `🎁 Giveaway for ${groupName(input.title)}`,
      "Tap below to set it up in a private chat with me: prize, draw time, then fund it from your wallet. Once it's live, I'll post it here.",
    ].join("\n"),
    buttons: [
      [
        {
          text: "Set up giveaway",
          url: `https://t.me/${bot}?start=${groupStartPayload(input.chatId)}`,
        },
      ],
    ],
  };
}

/** The private chat's answer to the setup link: open the studio for that group. */
export function privateGroupSetupMessage(input: {
  appUrl: string;
  chatId: string;
  title?: null | string;
}): BotMessage {
  const url = new URL(`${new URL(input.appUrl).origin}/telegram`);
  url.searchParams.set("mode", "create");
  url.searchParams.set("group", input.chatId);
  return {
    text: [
      `Giveaway for ${groupName(input.title)}`,
      "",
      "Choose the prize and draw time, then fund it from your wallet. Once it's live, I'll post it in the group, remind everyone shortly before entries close and announce the winner there.",
    ].join("\n"),
    buttons: [[{ text: "Set up giveaway", web_app: { url: url.toString() } }]],
  };
}

export function privateGroupNotAdminText(title?: null | string): string {
  return `Only admins of ${groupName(title)} can run a giveaway there.`;
}

export const privateGroupMissingText =
  "I'm not in that group anymore. Add me again, then send /giveaway there.";

export type GroupGiveawayEvent = "announce" | "reminder" | "result";

export type GroupGiveawayFacts = V6GiveawayShareInput & { winnerAddress: null | string };

/**
 * What the bot posts in a group for one giveaway. Null when the event no
 * longer fits the giveaway's state (e.g. a result for a giveaway still open).
 */
export function groupGiveawayMessage(
  event: GroupGiveawayEvent,
  facts: GroupGiveawayFacts,
  appUrl: string,
): BotMessage | null {
  const link = giveawayUrl(appUrl, facts.publicId);
  const title = facts.title.length > 80 ? `${facts.title.slice(0, 79)}…` : facts.title;
  const spotsLeft = Math.max(0, facts.participantCap - facts.participantCount);
  if (event === "announce" || event === "reminder") {
    if (facts.phase !== "open") return null;
    const full = spotsLeft === 0;
    if (event === "reminder" && full) return null;
    const lines =
      event === "announce"
        ? [
            `🎁 ${title}`,
            `${facts.amountKas} KAS · free entry · fair on-chain draw`,
            full
              ? `All ${facts.participantCap} spots taken · winner drawn after ${utc(facts.closesAt)}`
              : `${facts.participantCount}/${facts.participantCap} spots taken · entries close ${utc(facts.closesAt)}`,
          ]
        : [
            `⏰ Last call: ${title}`,
            `${facts.amountKas} KAS · ${spotsLeft} of ${facts.participantCap} spots left · entries close ${utc(facts.closesAt)}`,
          ];
    return {
      text: lines.join("\n"),
      buttons: [[{ text: full ? "View giveaway" : "Join giveaway", url: link }]],
    };
  }
  if (facts.phase === "drawn") {
    const winner = facts.winnerAddress ? shortAddress(facts.winnerAddress) : "The winner";
    return {
      text: [
        `🏆 Winner drawn: ${title}`,
        `${winner} won ${facts.amountKas} KAS, paid automatically on Kaspa.`,
        "Anyone can check the draw on the giveaway page.",
      ].join("\n"),
      buttons: [
        [{ text: "Check the draw", url: link }],
        [{ text: "Run your own giveaway", url: `${new URL(appUrl).origin}/bot?from=tg-group` }],
      ],
    };
  }
  if (facts.phase === "returned") {
    return {
      text: `${title} has ended without a winner, so the prize went back to the creator's wallet.`,
      buttons: [[{ text: "View giveaway", url: link }]],
    };
  }
  return null;
}
