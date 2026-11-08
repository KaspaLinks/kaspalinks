import type { TelegramInlineButton } from "./telegram-types.ts";

export class TelegramApiError extends Error {
  constructor(
    message: string,
    public readonly permanent: boolean,
    public readonly errorCode?: number,
    public readonly retryAfterSeconds?: number,
    public readonly connectionUnavailable = false,
    /** A group became a supergroup; resend to this chat id. */
    public readonly migrateToChatId?: string,
  ) {
    super(message);
  }
}

type TelegramApiResponse<T> = {
  description?: string;
  error_code?: number;
  parameters?: { migrate_to_chat_id?: number; retry_after?: number };
  ok: boolean;
  result?: T;
};

export type TelegramBotCommand = {
  command: string;
  description: string;
};

export type TelegramBotCommandScope = { type: "all_group_chats" } | { type: "all_private_chats" };

/** Members whose status lets them manage a group. */
export function isTelegramGroupAdminStatus(status: string): boolean {
  return status === "creator" || status === "administrator";
}

export class TelegramApiClient {
  constructor(
    private readonly botToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!botToken.trim()) throw new Error("Telegram bot token is required.");
  }

  async sendMessage(input: {
    buttons?: TelegramInlineButton[][];
    chatId: string;
    disableWebPagePreview?: boolean;
    /** Answer this message in a group; still sent if it was deleted meanwhile. */
    replyToMessageId?: number;
    text: string;
  }): Promise<{ message_id: number }> {
    return this.call("sendMessage", {
      chat_id: input.chatId,
      disable_web_page_preview: input.disableWebPagePreview ?? true,
      ...(input.buttons ? { reply_markup: { inline_keyboard: input.buttons } } : {}),
      ...(input.replyToMessageId
        ? {
            reply_parameters: {
              allow_sending_without_reply: true,
              message_id: input.replyToMessageId,
            },
          }
        : {}),
      text: input.text,
    });
  }

  /** Replaces a message the bot sent, e.g. a question once it was answered. */
  async editMessageText(input: {
    buttons?: TelegramInlineButton[][];
    chatId: string;
    messageId: number;
    text: string;
  }): Promise<unknown> {
    return this.call("editMessageText", {
      chat_id: input.chatId,
      link_preview_options: { is_disabled: true },
      message_id: input.messageId,
      reply_markup: { inline_keyboard: input.buttons ?? [] },
      text: input.text,
    });
  }

  /** One member's status in a group the bot belongs to, e.g. "administrator". */
  async getChatMember(chatId: string, userId: string): Promise<{ status: string }> {
    return this.call("getChatMember", { chat_id: chatId, user_id: userId });
  }

  async savePreparedInlineMessage(
    userId: string,
    result: Record<string, unknown>,
  ): Promise<{ id: string; expiration_date: number }> {
    return this.call("savePreparedInlineMessage", {
      user_id: userId,
      result,
      allow_user_chats: true,
      allow_group_chats: true,
      allow_channel_chats: true,
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    return this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  async setWebhook(input: { secretToken: string; url: string }): Promise<boolean> {
    return this.call("setWebhook", {
      allowed_updates: ["message", "callback_query", "my_chat_member"],
      drop_pending_updates: false,
      secret_token: input.secretToken,
      url: input.url,
    });
  }

  async setMyCommands(
    commands: TelegramBotCommand[],
    scope?: TelegramBotCommandScope,
  ): Promise<boolean> {
    return this.call("setMyCommands", { commands, ...(scope ? { scope } : {}) });
  }

  /** The default menu button for every private chat with the bot. */
  async setChatMenuButton(input: { text: string; url: string }): Promise<boolean> {
    return this.call("setChatMenuButton", {
      menu_button: { text: input.text, type: "web_app", web_app: { url: input.url } },
    });
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.telegram.org/bot${this.botToken}/${method}`, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new TelegramApiError((error as Error).message, false);
    }

    let payload: TelegramApiResponse<T>;
    try {
      payload = (await response.json()) as TelegramApiResponse<T>;
    } catch {
      throw new TelegramApiError(
        `Telegram returned HTTP ${response.status}.`,
        response.status === 403,
        response.status,
        undefined,
        response.status === 403,
      );
    }
    if (!response.ok || !payload.ok || payload.result === undefined) {
      const code = payload.error_code ?? response.status;
      throw new TelegramApiError(
        payload.description ?? "Telegram request failed.",
        code === 400 || code === 403,
        code,
        Number.isFinite(payload.parameters?.retry_after)
          ? Math.max(1, payload.parameters!.retry_after!)
          : undefined,
        code === 403,
        Number.isSafeInteger(payload.parameters?.migrate_to_chat_id)
          ? String(payload.parameters!.migrate_to_chat_id)
          : undefined,
      );
    }
    return payload.result;
  }
}
