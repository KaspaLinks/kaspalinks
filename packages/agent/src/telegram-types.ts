export type TelegramUser = {
  id: number | string;
  username?: string;
};

export type TelegramChat = {
  id: number | string;
  type: "channel" | "group" | "private" | "supergroup";
};

export type TelegramMessage = {
  chat: TelegramChat;
  from?: TelegramUser;
  message_id: number;
  text?: string;
};

export type TelegramCallbackQuery = {
  data?: string;
  from: TelegramUser;
  id: string;
  message?: TelegramMessage;
};

export type TelegramUpdate = {
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
  update_id: number | string;
};

export type TelegramInlineButton = {
  callback_data?: string;
  text: string;
  url?: string;
};
