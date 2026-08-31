import type { TelegramInlineButton } from "./telegram-types.ts";

export class TelegramApiError extends Error {
  constructor(
    message: string,
    public readonly permanent: boolean,
    public readonly errorCode?: number,
  ) {
    super(message);
  }
}

type TelegramApiResponse<T> = {
  description?: string;
  error_code?: number;
  ok: boolean;
  result?: T;
};

export type TelegramBotCommand = {
  command: string;
  description: string;
};

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
    text: string;
  }): Promise<{ message_id: number }> {
    return this.call("sendMessage", {
      chat_id: input.chatId,
      disable_web_page_preview: input.disableWebPagePreview ?? true,
      ...(input.buttons ? { reply_markup: { inline_keyboard: input.buttons } } : {}),
      text: input.text,
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
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
      secret_token: input.secretToken,
      url: input.url,
    });
  }

  async setMyCommands(commands: TelegramBotCommand[]): Promise<boolean> {
    return this.call("setMyCommands", { commands });
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
      );
    }
    if (!response.ok || !payload.ok || payload.result === undefined) {
      const code = payload.error_code ?? response.status;
      throw new TelegramApiError(
        payload.description ?? "Telegram request failed.",
        code === 400 || code === 403,
        code,
      );
    }
    return payload.result;
  }
}
