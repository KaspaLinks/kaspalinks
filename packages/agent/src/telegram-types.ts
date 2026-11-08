export type TelegramUser = {
  id: number | string;
  username?: string;
};

export type TelegramChat = {
  id: number | string;
  title?: string;
  type: "channel" | "group" | "private" | "supergroup";
};

export type TelegramMessage = {
  chat: TelegramChat;
  from?: TelegramUser;
  message_id: number;
  /** Set when a group became a supergroup; the group continues under this id. */
  migrate_to_chat_id?: number | string;
  text?: string;
};

/** The bot's own membership in a chat changed (added, removed, promoted). */
export type TelegramChatMemberUpdated = {
  chat: TelegramChat;
  from: TelegramUser;
  new_chat_member: { status: string };
  old_chat_member: { status: string };
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
  my_chat_member?: TelegramChatMemberUpdated;
  update_id: number | string;
};

export type TelegramInlineButton = {
  callback_data?: string;
  text: string;
  url?: string;
  web_app?: { url: string };
};
