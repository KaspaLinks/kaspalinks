/** The public bot username without "@", or null when it is unset or not a valid Telegram name. */
export function telegramBotUsername(): null | string {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") ?? "";
  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : null;
}

export function telegramBotUrl(): null | string {
  const username = telegramBotUsername();
  return username ? `https://t.me/${username}` : null;
}
