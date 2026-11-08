import {
  isTelegramGroupAdminStatus,
  TelegramApiClient,
  TelegramApiError,
} from "@kaspa-actions/agent";
import {
  ApplicationError,
  linkGiveawayToTelegramGroup,
  markTelegramGroupRemoved,
} from "@kaspa-actions/application";
import { AuditActorType, prisma, type Creator } from "@kaspa-actions/db";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { isGiveawayV6CreationEnabled } from "@/lib/giveaway-v6-creation";
import { requireTelegramParticipant } from "@/lib/telegram-giveaway";

export const runtime = "nodejs";

// Group chat ids are negative; private chats can't be announcement targets.
const chatIdSchema = z.string().regex(/^-\d{1,20}$/);
const linkSchema = z.object({ publicId: z.string().cuid() }).strict();

type Context = { params: Promise<{ chatId: string }> };
type Authorized = {
  creator: Creator;
  group: { chatId: string; title: null | string };
  ipHash: string;
  ok: true;
  userId: string;
};

const missingGroup = () =>
  apiError(
    ErrorCodes.NOT_FOUND,
    "The bot is no longer in this group. Add it again and send /giveaway there.",
    404,
  );

/**
 * The Mini App user, their workspace, and a live check with Telegram that they
 * are an admin of the group. Being able to open the link proves nothing.
 */
async function authorize(
  request: Request,
  context: Context,
): Promise<Authorized | { ok: false; response: Response }> {
  if (!isGiveawayV6CreationEnabled()) {
    return { ok: false, response: apiError(ErrorCodes.NOT_FOUND, "Giveaways are disabled.", 404) };
  }
  const chat = chatIdSchema.safeParse((await context.params).chatId);
  if (!chat.success) return { ok: false, response: missingGroup() };
  const participant = requireTelegramParticipant(request);
  if (!participant.ok) return participant;
  const guard = await requireCreator(request, prisma, {
    allowTelegramMiniApp: true,
    allowTelegramOnly: true,
  });
  if (!guard.ok) return guard;
  const group = await prisma.telegramGroup.findUnique({
    select: { chatId: true, removedAt: true, title: true },
    where: { chatId: chat.data },
  });
  if (!group || group.removedAt) return { ok: false, response: missingGroup() };
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return {
      ok: false,
      response: apiError(ErrorCodes.SERVER_ERROR, "Telegram is unavailable.", 503),
    };
  }
  let status: string;
  try {
    status = (await new TelegramApiClient(token).getChatMember(group.chatId, participant.userId))
      .status;
  } catch (error) {
    if (error instanceof TelegramApiError && error.permanent) {
      if (error.connectionUnavailable || /chat not found/i.test(error.message)) {
        await markTelegramGroupRemoved(prisma, group.chatId);
        return { ok: false, response: missingGroup() };
      }
      status = "unknown";
    } else {
      return {
        ok: false,
        response: apiError(
          ErrorCodes.UPSTREAM_TIMEOUT,
          "Telegram could not confirm your admin rights. Try again shortly.",
          503,
        ),
      };
    }
  }
  if (!isTelegramGroupAdminStatus(status)) {
    return {
      ok: false,
      response: apiError(
        ErrorCodes.CREATOR_TOKEN_INVALID,
        "Only admins of this group can announce giveaways there.",
        403,
      ),
    };
  }
  return {
    creator: guard.creator,
    group: { chatId: group.chatId, title: group.title },
    ipHash: guard.ipHash,
    ok: true,
    userId: participant.userId,
  };
}

/** The group's name and which of the caller's giveaways are already announced there. */
export async function GET(request: Request, context: Context) {
  const auth = await authorize(request, context);
  if (!auth.ok) return auth.response;
  const links = await prisma.telegramGroupGiveaway.findMany({
    select: { giveaway: { select: { publicId: true } } },
    take: 50,
    where: { giveaway: { creatorId: auth.creator.id }, group: { chatId: auth.group.chatId } },
  });
  return apiJson({
    group: auth.group,
    linkedPublicIds: links.map((link) => link.giveaway.publicId),
  });
}

/** Announce one of the caller's giveaways in the group. */
export async function POST(request: Request, context: Context) {
  const auth = await authorize(request, context);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) return apiError(ErrorCodes.INVALID_BODY, "Giveaway not found.", 400);
  try {
    const result = await linkGiveawayToTelegramGroup(prisma, {
      chatId: auth.group.chatId,
      creatorId: auth.creator.id,
      publicId: parsed.data.publicId,
      telegramUserId: auth.userId,
    });
    if (result.created) {
      await writeAuditLog(prisma, {
        actorType: AuditActorType.CREATOR,
        creatorId: auth.creator.id,
        event: "giveaway.telegram_group_linked",
        ipHash: auth.ipHash,
        metadata: { publicId: parsed.data.publicId },
      });
    }
    return apiJson({ group: auth.group, linked: true });
  } catch (error) {
    if (error instanceof ApplicationError) {
      return apiError(
        error.status === 404 ? ErrorCodes.NOT_FOUND : ErrorCodes.INVALID_STATE,
        error.message,
        error.status,
      );
    }
    return apiError(ErrorCodes.SERVER_ERROR, "The giveaway could not be linked. Try again.", 503);
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET", "POST"]);
export { methodNotAllowed as DELETE, methodNotAllowed as PATCH, methodNotAllowed as PUT };
