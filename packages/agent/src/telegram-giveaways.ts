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
