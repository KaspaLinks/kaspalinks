import { prisma } from "@kaspa-actions/db";
import {
  actorContext,
  ApplicationError,
  createActionTool,
  updateAgentSettingsTool,
} from "@kaspa-actions/application";
import { slugifyAgentTitle } from "@kaspa-actions/agent";
import { z } from "zod";

import { requireCreator } from "@/lib/creator-guard";
import { touchTelegramActivity } from "@/lib/telegram-activity";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { normalizeKaspaAddressInput } from "@/lib/kaspa-address-input";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  isTelegramOnlyAccount,
  TELEGRAM_PAYMENT_LINK_TYPES,
  telegramActionPath,
} from "@/lib/telegram-links";

// The Mini App's "Get paid" form: the same payment links as /tip or /goal in the
// bot, without command syntax. The wallet is saved once for the workspace.

const bodySchema = z
  .object({
    // Explicit opt-in from the form: payment alerts in this chat.
    alerts: z.boolean().optional(),
    amountKas: z.string().trim().max(32).optional(),
    description: z.string().trim().max(280).optional(),
    title: z.string().trim().min(1).max(80),
    type: z.enum(TELEGRAM_PAYMENT_LINK_TYPES),
    walletAddress: z.string().trim().max(200).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const guard = await requireCreator(request, prisma, {
    allowTelegramMiniApp: true,
    allowTelegramOnly: true,
  });
  if (!guard.ok) return guard.response;
  await touchTelegramActivity(prisma, { creatorId: guard.creator.id });
  const limited = enforceRateLimit(RateBuckets.CREATOR_ACTION_CREATE, guard.creator.id);
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, "Check the title, amount and link type.", 400);
  }
  const input = parsed.data;
  const actor = actorContext(guard.creator.id, "telegram");
  const amountKas = input.amountKas?.replace(",", ".") || undefined;

  try {
    let wallet = guard.creator.defaultRecipientAddress;
    const requested = input.walletAddress ? normalizeKaspaAddressInput(input.walletAddress) : "";
    const walletChanged = requested !== "" && requested !== wallet;
    if (walletChanged) wallet = requested;
    if (!wallet) {
      return apiError(ErrorCodes.INVALID_BODY, "Enter the wallet that receives payments.", 400);
    }
    if (walletChanged || input.alerts !== undefined) {
      await updateAgentSettingsTool(prisma, actor, {
        ...(walletChanged ? { defaultRecipientAddress: wallet } : {}),
        ...(input.alerts !== undefined ? { notificationsEnabled: input.alerts } : {}),
      });
    }

    const telegramOnly = isTelegramOnlyAccount(guard.creator);
    const action = await createActionTool(
      prisma,
      actor,
      {
        ...(input.type === "kaspa.goal" ? { goalKas: amountKas } : amountKas ? { amountKas } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(telegramOnly ? { hiddenFromProfile: true } : {}),
        recipientAddress: wallet,
        slug: slugifyAgentTitle(input.title),
        title: input.title,
        type: input.type,
      },
      {
        ...(telegramOnly ? { accountFree: { source: "telegram-bot" } } : {}),
        ipHash: guard.ipHash,
      },
    );
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://kaspalinks.com").replace(/\/$/, "");
    return apiJson(
      {
        action: {
          publicId: action.publicId,
          title: action.title,
          url: `${appUrl}${telegramActionPath(guard.creator, action)}`,
        },
        wallet,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ApplicationError) {
      return apiError(ErrorCodes.INVALID_BODY, error.message, error.status);
    }
    throw error;
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
