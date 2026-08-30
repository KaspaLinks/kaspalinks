import { createHash, timingSafeEqual } from "node:crypto";

import {
  OpenAiIntentInterpreter,
  TelegramApiClient,
  TelegramCommandError,
  estimateAiCostMicros,
  parseAiPrice,
  parseTelegramCommand,
  slugifyAgentTitle,
  type InterpretedIntent,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUpdate as TelegramUpdatePayload,
} from "@kaspa-actions/agent";
import {
  actorContext,
  ApplicationError,
  confirmIntentDraftTool,
  consumeTelegramConnectCodeTool,
  createClarificationDraftTool,
  createGiveawaySetupDraftTool,
  createIntentDraftTool,
  createActionTool,
  disconnectTelegramTool,
  getCreatorStatsTool,
  listGiveawaysTool,
  listActionsTool,
  listPaymentsTool,
  recordAiUsage,
  reserveAiQuota,
  updateAgentSettingsTool,
} from "@kaspa-actions/application";
import { Prisma, prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";
import { z } from "zod";

import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";

export const runtime = "nodejs";

const telegramUpdateSchema = z
  .object({
    callback_query: z.unknown().optional(),
    message: z.unknown().optional(),
    update_id: z.union([z.number(), z.string()]),
  })
  .passthrough();

function secureEquals(presented: string, expected: string): boolean {
  const left = createHash("sha256").update(presented).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function agentSettingsUrl() {
  return `${requiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "")}/agent`;
}

function helpButtons() {
  return [
    [
      { callback_data: "menu:links", text: "My links" },
      { callback_data: "menu:payments", text: "Payments" },
      { callback_data: "menu:stats", text: "Stats" },
    ],
    [{ callback_data: "menu:giveaways", text: "Giveaways" }],
    [{ text: "Agent settings", url: agentSettingsUrl() }],
  ];
}

const helpText = [
  "KaspaLinks Agent commands",
  "/links - recent links",
  "/payments - recent confirmed payments",
  "/stats - totals",
  "/giveaways - recent giveaways",
  "/giveaway <KAS> <duration> <title>",
  "/link <KAS> <title>",
  "/invoice <KAS> <title>",
  "/tip [KAS] <title>",
  "/donation [KAS] <title>",
  "/goal <KAS target> <title>",
  "/disconnect",
].join("\n");

function isUniqueUpdateError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function connectedCreator(telegramUserId: string) {
  return prisma.telegramConnection.findUnique({
    include: { creator: true },
    where: { telegramUserId },
  });
}

async function renderLinks(creatorId: string): Promise<string> {
  const links = await listActionsTool(prisma, actorContext(creatorId, "telegram"), 10);
  if (links.length === 0) return "You do not have any links yet.";
  const appUrl = requiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
  const creator = await prisma.creator.findUniqueOrThrow({ where: { id: creatorId } });
  return links
    .map((action) => {
      const path = action.slug ? `/u/${creator.username}/${action.slug}` : `/a/${action.publicId}`;
      return `${action.disabledAt ? "Disabled" : "Active"}: ${action.title}\n${appUrl}${path}`;
    })
    .join("\n\n");
}

async function renderPayments(creatorId: string): Promise<string> {
  const payments = await listPaymentsTool(prisma, actorContext(creatorId, "telegram"), 10);
  if (payments.length === 0) return "No confirmed payments yet.";
  return payments
    .map((payment) => {
      const amount = payment.amountSompi ? `${formatSompiToKaspa(payment.amountSompi)} KAS` : "KAS";
      const tx = payment.txId
        ? `${payment.txId.slice(0, 10)}...${payment.txId.slice(-8)}`
        : "pending tx";
      return `${amount} - ${payment.action.title}\n${tx}`;
    })
    .join("\n\n");
}

async function renderStats(creatorId: string): Promise<string> {
  const stats = await getCreatorStatsTool(prisma, actorContext(creatorId, "telegram"));
  return [
    "KaspaLinks stats",
    `${stats.links} links`,
    `${stats.confirmedPayments} confirmed payments`,
    `${formatSompiToKaspa(stats.receivedSompi)} KAS received`,
  ].join("\n");
}

function giveawayStateLabel(giveaway: Awaited<ReturnType<typeof listGiveawaysTool>>[number]) {
  if (giveaway.prizeStatus === "claimed") return "Prize claimed";
  if (giveaway.prizeStatus === "refunded") return "Prize refunded";
  if (!giveaway.funded) return "Waiting for prize funding";
  if (giveaway.status === "DRAWN") {
    if (giveaway.winnerClaimExpiresAt && giveaway.winnerClaimExpiresAt.getTime() <= Date.now()) {
      return "Winner claim window closed";
    }
    return "Winner selected";
  }
  if (giveaway.status === "NO_ENTRIES") return "Closed without entries";
  if (giveaway.status === "CANCELLED") return "Cancelled";
  if (giveaway.closesAt.getTime() <= Date.now()) return "Entries closed; draw pending";
  return "Entries open";
}

async function renderGiveaways(creatorId: string): Promise<string> {
  const giveaways = await listGiveawaysTool(prisma, actorContext(creatorId, "telegram"), 10);
  if (giveaways.length === 0) return "You do not have any giveaways yet.";
  const appUrl = requiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
  return giveaways
    .map(
      (giveaway) =>
        `${giveawayStateLabel(giveaway)}: ${giveaway.title}\n` +
        `${giveaway.amountKas} KAS · ${giveaway.entryCount} entries\n` +
        `${appUrl}/toccata-lab/giveaway/${encodeURIComponent(giveaway.publicId)}`,
    )
    .join("\n\n");
}

async function executeMenuAction(action: string, creatorId: string): Promise<string> {
  if (action === "giveaways") return renderGiveaways(creatorId);
  if (action === "links") return renderLinks(creatorId);
  if (action === "payments") return renderPayments(creatorId);
  if (action === "stats") return renderStats(creatorId);
  return helpText;
}

async function createGiveawayHandoff(
  connection: NonNullable<Awaited<ReturnType<typeof connectedCreator>>>,
  command: Extract<ReturnType<typeof parseTelegramCommand>, { kind: "prepare_giveaway" }>,
) {
  const draft = await createGiveawaySetupDraftTool(
    prisma,
    actorContext(connection.creatorId, "telegram"),
    connection.telegramUserId,
    {
      amountKas: command.amountKas,
      entryWindowSeconds: command.entryWindowSeconds,
      title: command.title,
      winnerClaimWindowSeconds: 24 * 60 * 60,
    },
  );
  const url = `${requiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "")}/toccata-lab/giveaway?draft=${encodeURIComponent(draft.id)}`;
  return { draft, url };
}

async function handleCallback(client: TelegramApiClient, callback: TelegramCallbackQuery) {
  const chat = callback.message?.chat;
  if (!chat || chat.type !== "private") {
    await client.answerCallbackQuery(callback.id, "Private chats only.");
    return;
  }
  const telegramUserId = String(callback.from.id);
  const connection = await connectedCreator(telegramUserId);
  if (!connection || connection.telegramChatId !== String(chat.id)) {
    await client.answerCallbackQuery(callback.id, "Connect this private chat first.");
    return;
  }
  const actor = actorContext(connection.creatorId, "telegram");
  const data = callback.data ?? "";

  if (data === "notify:on" || data === "notify:off") {
    await updateAgentSettingsTool(prisma, actor, { notificationsEnabled: data === "notify:on" });
    await client.answerCallbackQuery(
      callback.id,
      data === "notify:on" ? "Alerts enabled." : "Alerts disabled.",
    );
    return;
  }
  if (data.startsWith("menu:")) {
    await client.sendMessage({
      chatId: String(chat.id),
      text: await executeMenuAction(data.slice(5), connection.creatorId),
    });
    await client.answerCallbackQuery(callback.id);
    return;
  }
  if (data.startsWith("draft:")) {
    const result = await confirmIntentDraftTool(
      prisma,
      actor,
      telegramUserId,
      data.slice("draft:".length),
    );
    await client.sendMessage({
      chatId: String(chat.id),
      text: result.alreadyConfirmed
        ? "This draft was already confirmed."
        : "Confirmed and created successfully.",
    });
    await client.answerCallbackQuery(callback.id, "Confirmed.");
    return;
  }
  await client.answerCallbackQuery(callback.id, "Unknown action.");
}

async function createFromCommand(
  connection: Awaited<ReturnType<typeof connectedCreator>> & {},
  command: Extract<ReturnType<typeof parseTelegramCommand>, { kind: "create_action" }>,
  updateId: string,
) {
  if (!connection.creator.defaultRecipientAddress) {
    throw new ApplicationError(
      "DEFAULT_ADDRESS_REQUIRED",
      `Set a default recipient address first: ${agentSettingsUrl()}`,
      409,
    );
  }
  const action = await createActionTool(
    prisma,
    actorContext(connection.creatorId, "telegram"),
    {
      ...(command.type === "kaspa.goal"
        ? { goalKas: command.amountKas }
        : command.amountKas
          ? { amountKas: command.amountKas }
          : {}),
      recipientAddress: connection.creator.defaultRecipientAddress,
      slug: slugifyAgentTitle(command.title),
      title: command.title,
      type: command.type,
    },
    { idempotencyKey: `telegram-update:${updateId}` },
  );
  const path = action.slug
    ? `/u/${connection.creator.username}/${action.slug}`
    : `/a/${action.publicId}`;
  return `Created: ${action.title}\n${requiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "")}${path}`;
}

async function resolveRuleActionId(
  creatorId: string,
  reference: string | null,
): Promise<string | undefined> {
  if (!reference) return undefined;
  const action = await prisma.action.findFirst({
    select: { id: true },
    where: {
      creatorId,
      deletedAt: null,
      OR: [
        { id: reference },
        { publicId: reference },
        { slug: reference.toLowerCase() },
        { title: { equals: reference, mode: "insensitive" } },
      ],
    },
  });
  if (!action) throw new ApplicationError("ACTION_NOT_FOUND", "I could not find that link.", 404);
  return action.id;
}

async function handleAiText(
  client: TelegramApiClient,
  connection: NonNullable<Awaited<ReturnType<typeof connectedCreator>>>,
  text: string,
) {
  if (
    process.env.AGENT_AI_ENABLED !== "true" ||
    !connection.creator.agentAiEnabled ||
    !connection.creator.agentAiConsentAt
  ) {
    await client.sendMessage({
      chatId: connection.telegramChatId,
      text: helpText,
      buttons: helpButtons(),
    });
    return;
  }
  if (text.length > 750)
    throw new ApplicationError("AI_INPUT_TOO_LONG", "Use 750 characters or less.");

  const actor = actorContext(connection.creatorId, "telegram");
  const model = process.env.OPENAI_AGENT_MODEL?.trim() || "gpt-5.6-luna";
  const inputPrice = parseAiPrice(
    process.env.OPENAI_AGENT_INPUT_USD_PER_MILLION,
    0.2,
    "OPENAI_AGENT_INPUT_USD_PER_MILLION",
  );
  const outputPrice = parseAiPrice(
    process.env.OPENAI_AGENT_OUTPUT_USD_PER_MILLION,
    1.2,
    "OPENAI_AGENT_OUTPUT_USD_PER_MILLION",
  );
  const reservedCost = estimateAiCostMicros(
    { inputTokens: 512, outputTokens: 300 },
    { inputUsdPerMillion: inputPrice, outputUsdPerMillion: outputPrice },
  );
  const reservation = await reserveAiQuota(
    prisma,
    actor,
    connection.creator.timezone,
    reservedCost,
  );
  const interpreter = new OpenAiIntentInterpreter({
    apiKey: requiredEnv("OPENAI_API_KEY"),
    model,
  });

  let result: Awaited<ReturnType<OpenAiIntentInterpreter["interpret"]>>;
  try {
    result = await interpreter.interpret(text);
  } catch (error) {
    await recordAiUsage(prisma, actor, reservation, {
      actualCostMicros: reservedCost,
      errorCode: "INTERPRETER_FAILED",
      model,
      status: "failed",
    });
    throw error;
  }

  const cost = estimateAiCostMicros(result, {
    inputUsdPerMillion: inputPrice,
    outputUsdPerMillion: outputPrice,
  });
  await recordAiUsage(prisma, actor, reservation, {
    actualCostMicros: cost,
    inputTokens: result.inputTokens,
    intent: result.intent.intent,
    model,
    outputTokens: result.outputTokens,
    status: "completed",
  });
  await respondToAiIntent(client, connection, result.intent, reservation.warning);
}

async function respondToAiIntent(
  client: TelegramApiClient,
  connection: NonNullable<Awaited<ReturnType<typeof connectedCreator>>>,
  intent: InterpretedIntent,
  warning: boolean,
) {
  const actor = actorContext(connection.creatorId, "telegram");
  if (intent.intent === "list_links") {
    await client.sendMessage({
      chatId: connection.telegramChatId,
      text: await renderLinks(connection.creatorId),
    });
    return;
  }
  if (intent.intent === "list_payments") {
    await client.sendMessage({
      chatId: connection.telegramChatId,
      text: await renderPayments(connection.creatorId),
    });
    return;
  }
  if (intent.intent === "read_stats") {
    await client.sendMessage({
      chatId: connection.telegramChatId,
      text: await renderStats(connection.creatorId),
    });
    return;
  }
  if (intent.intent === "needs_clarification") {
    await createClarificationDraftTool(prisma, actor, connection.telegramUserId, {
      actionReference: intent.actionReference,
      actionType: intent.actionType,
      amountKas: intent.amountKas,
      goalKas: intent.goalKas,
      title: intent.title,
    });
    await client.sendMessage({
      chatId: connection.telegramChatId,
      text: intent.clarificationQuestion ?? "Please clarify the missing details.",
    });
    return;
  }
  if (intent.intent === "create_action") {
    if (!connection.creator.defaultRecipientAddress) {
      throw new ApplicationError(
        "DEFAULT_ADDRESS_REQUIRED",
        `Set a default recipient address first: ${agentSettingsUrl()}`,
      );
    }
    if (!intent.actionType || !intent.title) {
      throw new ApplicationError("AI_INTENT_INVALID", "The action type or title is missing.");
    }
    const draft = await createIntentDraftTool(prisma, actor, connection.telegramUserId, {
      intent: "create_action",
      payload: {
        ...(intent.actionType === "kaspa.goal"
          ? { goalKas: intent.goalKas ?? undefined }
          : { amountKas: intent.amountKas ?? undefined }),
        recipientAddress: connection.creator.defaultRecipientAddress,
        slug: slugifyAgentTitle(intent.title),
        title: intent.title,
        type: intent.actionType,
      },
    });
    await client.sendMessage({
      buttons: [[{ callback_data: `draft:${draft.id}`, text: "Confirm" }]],
      chatId: connection.telegramChatId,
      text: `Draft: create ${intent.actionType} "${intent.title}"${warning ? "\nAI budget is above 80%." : ""}`,
    });
    return;
  }
  if (intent.intent === "create_notification_rule") {
    if (!intent.ruleKind)
      throw new ApplicationError("AI_INTENT_INVALID", "The rule type is missing.");
    const actionId = await resolveRuleActionId(connection.creatorId, intent.actionReference);
    const draft = await createIntentDraftTool(prisma, actor, connection.telegramUserId, {
      intent: "create_notification_rule",
      payload: {
        ...(actionId ? { actionId } : {}),
        completeOnInvoicePayment: intent.completeOnInvoicePayment ?? false,
        kind: intent.ruleKind,
        ...(intent.minimumKas ? { minimumKas: intent.minimumKas } : {}),
      },
    });
    await client.sendMessage({
      buttons: [[{ callback_data: `draft:${draft.id}`, text: "Confirm rule" }]],
      chatId: connection.telegramChatId,
      text: `Draft notification rule: ${intent.ruleKind}`,
    });
    return;
  }
  await client.sendMessage({
    chatId: connection.telegramChatId,
    text: "I could not map that request. Try /help.",
  });
}

async function handleMessage(
  client: TelegramApiClient,
  message: TelegramMessage,
  updateId: string,
) {
  if (message.chat.type !== "private" || !message.from) return;
  const chatId = String(message.chat.id);
  const telegramUserId = String(message.from.id);
  const text = message.text?.trim();
  if (!text) return;

  const command = parseTelegramCommand(text);
  if (command?.kind === "connect") {
    const connected = await consumeTelegramConnectCodeTool(prisma, {
      code: command.code,
      telegramChatId: chatId,
      telegramUserId,
    });
    await client.sendMessage({
      buttons: [
        [
          { callback_data: "notify:on", text: "Enable payment alerts" },
          { callback_data: "notify:off", text: "Not now" },
        ],
      ],
      chatId,
      text: `Connected to KaspaLinks creator ${connected.creator.username}. Payment alerts are off until you enable them.`,
    });
    return;
  }

  const connection = await connectedCreator(telegramUserId);
  if (!connection || connection.telegramChatId !== chatId) {
    await client.sendMessage({
      buttons: [[{ text: "Open Agent settings", url: agentSettingsUrl() }]],
      chatId,
      text:
        "This private chat is not connected yet. Open KaspaLinks Agent settings, generate a new " +
        "connection code, then tap Start or send /connect followed by that code. Opening the chat " +
        "alone does not connect it.",
    });
    return;
  }

  if (!command) {
    await handleAiText(client, connection, text);
    return;
  }
  if (command.kind === "start" || command.kind === "help") {
    await client.sendMessage({ buttons: helpButtons(), chatId, text: helpText });
    return;
  }
  if (command.kind === "disconnect") {
    await disconnectTelegramTool(prisma, actorContext(connection.creatorId, "telegram"));
    await client.sendMessage({ chatId, text: "Telegram disconnected from KaspaLinks." });
    return;
  }
  if (
    command.kind === "giveaways" ||
    command.kind === "links" ||
    command.kind === "payments" ||
    command.kind === "stats"
  ) {
    await client.sendMessage({
      chatId,
      text: await executeMenuAction(command.kind, connection.creatorId),
    });
    return;
  }
  if (command.kind === "prepare_giveaway") {
    const handoff = await createGiveawayHandoff(connection, command);
    await client.sendMessage({
      buttons: [[{ text: "Finish giveaway setup", url: handoff.url }]],
      chatId,
      text:
        `Giveaway draft: ${command.title}\n${command.amountKas} KAS\n` +
        "Finish the setup in your browser. Private prize and recovery keys never enter Telegram.",
    });
    return;
  }
  if (command.kind === "create_action") {
    await client.sendMessage({
      chatId,
      text: await createFromCommand(connection, command, updateId),
    });
    return;
  }
  await client.sendMessage({ chatId, text: "Unknown command. Try /help." });
}

export async function POST(request: Request) {
  let webhookSecret: string;
  let client: TelegramApiClient;
  try {
    webhookSecret = requiredEnv("TELEGRAM_WEBHOOK_SECRET");
    client = new TelegramApiClient(requiredEnv("TELEGRAM_BOT_TOKEN"));
  } catch {
    return apiError(ErrorCodes.SERVER_ERROR, "Telegram integration is unavailable.", 503);
  }
  const presented = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!presented || !secureEquals(presented, webhookSecret)) {
    return apiError(ErrorCodes.NOT_FOUND, "Not found.", 404);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }
  const parsed = telegramUpdateSchema.safeParse(raw);
  if (!parsed.success) return apiError(ErrorCodes.INVALID_BODY, "Invalid Telegram update.", 400);
  const update = parsed.data as TelegramUpdatePayload;
  const updateId = String(update.update_id);

  const processingAt = new Date();
  try {
    await prisma.telegramUpdate.create({
      data: { attempts: 1, processingAt, updateId },
    });
  } catch (error) {
    if (!isUniqueUpdateError(error)) throw error;
    const claimed = await prisma.telegramUpdate.updateMany({
      data: { attempts: { increment: 1 }, errorCode: null, processingAt },
      where: {
        processedAt: null,
        updateId,
        OR: [
          { processingAt: null },
          { processingAt: { lt: new Date(processingAt.getTime() - 2 * 60_000) } },
        ],
      },
    });
    if (claimed.count !== 1) return apiJson({ ok: true });
  }

  try {
    if (update.callback_query) await handleCallback(client, update.callback_query);
    else if (update.message) await handleMessage(client, update.message, updateId);
    await prisma.telegramUpdate.update({
      data: { errorCode: null, processedAt: new Date(), processingAt: null },
      where: { updateId },
    });
  } catch (error) {
    const code =
      error instanceof TelegramCommandError
        ? "COMMAND_INVALID"
        : error instanceof ApplicationError
          ? error.code
          : "PROCESSING_FAILED";
    await prisma.telegramUpdate.update({
      data: { errorCode: code, processingAt: null },
      where: { updateId },
    });
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId !== undefined) {
      try {
        await client.sendMessage({
          chatId: String(chatId),
          text:
            error instanceof TelegramCommandError || error instanceof ApplicationError
              ? error.message
              : "The request could not be completed. Try again shortly.",
        });
      } catch {
        // Telegram retries the update because this webhook returns 503 below.
      }
    }
    return apiError(ErrorCodes.SERVER_ERROR, "Telegram update could not be processed.", 503);
  }

  return apiJson({ ok: true });
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);
export { methodNotAllowed as DELETE, methodNotAllowed as GET, methodNotAllowed as PATCH };
