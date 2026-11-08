import { z } from "zod";

export const telegramGiveawayIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/);
export function telegramGiveawayLinks(appUrl: string, botUsername: string, publicId: string) {
  const id = telegramGiveawayIdSchema.parse(publicId);
  const bot = z
    .string()
    .regex(/^[a-zA-Z0-9_]{5,32}$/)
    .parse(botUsername.replace(/^@/, ""));
  const origin = new URL(appUrl).origin;
  return {
    entry: `${origin}/toccata-lab/giveaway/${id}`,
    miniApp: `https://t.me/${bot}?startapp=g_${id}`,
    bot: `https://t.me/${bot}?start=g_${id}`,
    watch: `https://t.me/${bot}?start=watch_${id}`,
    create: `${origin}/toccata-lab/giveaway?template=${id}`,
  };
}

export type GiveawayCardInput = {
  publicId: string;
  title: string;
  amountKas: string;
  creator: string;
  closesAt: Date;
  status: string;
  fundingConfirmed: boolean;
};
export function giveawayCardText(input: GiveawayCardInput) {
  return [
    input.title,
    `${input.amountKas} KAS · by ${input.creator}`,
    input.fundingConfirmed ? "Prize funding confirmed on-chain" : "Prize funding not confirmed",
    input.status === "OPEN"
      ? `Entries close: ${input.closesAt.toISOString().replace("T", " ").slice(0, 16)} UTC`
      : `Status: ${input.status}`,
    "Check the current status and terms before entering.",
  ].join("\n");
}

export function preparedGiveawayArticle(
  input: GiveawayCardInput,
  appUrl: string,
  botUsername: string,
) {
  const links = telegramGiveawayLinks(appUrl, botUsername, input.publicId);
  return {
    type: "article" as const,
    id: input.publicId,
    title: input.title,
    description: `${input.amountKas} KAS · ${input.creator}`,
    input_message_content: {
      message_text: giveawayCardText(input),
      link_preview_options: { is_disabled: true },
    },
    reply_markup: {
      inline_keyboard: [
        [{ text: "View giveaway", url: links.miniApp }],
        [{ text: "Open in browser", url: links.entry }],
      ],
    },
  };
}

/** Public facts of a SilverScript V6 giveaway, all reconstructed from the chain. */
export type V6GiveawayShareInput = {
  publicId: string;
  title: string;
  amountKas: string;
  closesAt: Date;
  participantCount: number;
  participantCap: number;
  phase: "awaiting_activation" | "drawn" | "frozen" | "open" | "returned";
};

const SHARE_TITLE_MAX = 80;

export function v6GiveawayShareText(input: V6GiveawayShareInput) {
  const title =
    input.title.length > SHARE_TITLE_MAX
      ? `${input.title.slice(0, SHARE_TITLE_MAX - 1)}…`
      : input.title;
  const close = input.closesAt.toISOString().replace("T", " ").slice(0, 16);
  const state =
    input.phase === "open"
      ? input.participantCount >= input.participantCap
        ? `All ${input.participantCap} spots taken · winner drawn after ${close} UTC`
        : `${input.participantCount}/${input.participantCap} spots taken · entries close ${close} UTC`
      : input.phase === "drawn"
        ? "Winner drawn and paid automatically"
        : input.phase === "returned"
          ? "Ended · prize returned"
          : input.phase === "frozen"
            ? "Entries closed · drawing the winner"
            : "Prize is being confirmed on Kaspa";
  return [`🎁 ${title}`, `${input.amountKas} KAS · free entry · fair on-chain draw`, state].join(
    "\n",
  );
}

/**
 * A share card for any chat or group. Both buttons are plain URLs: Telegram
 * allows only those in messages sent to groups, and the giveaway page handles
 * entry in Telegram's browser.
 */
export function preparedV6GiveawayArticle(input: V6GiveawayShareInput, appUrl: string) {
  const id = telegramGiveawayIdSchema.parse(input.publicId);
  const origin = new URL(appUrl).origin;
  const joinable = input.phase === "open" && input.participantCount < input.participantCap;
  return {
    type: "article" as const,
    id,
    title: input.title.slice(0, SHARE_TITLE_MAX),
    description: `${input.amountKas} KAS · free entry`,
    input_message_content: {
      message_text: v6GiveawayShareText(input),
      link_preview_options: { is_disabled: true },
    },
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: joinable ? "Join giveaway" : "View giveaway",
            url: `${origin}/giveaways/${id}?from=telegram`,
          },
        ],
        [{ text: "Run your own giveaway", url: `${origin}/giveaway/new?from=telegram` }],
      ],
    },
  };
}
