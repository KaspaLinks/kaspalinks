// Small helpers shared by the Mini App views.

export function telegramAuthHeaders(): Record<string, string> {
  const initData = typeof window === "undefined" ? "" : (window.Telegram?.WebApp?.initData ?? "");
  return initData ? { "x-telegram-mini-app-init-data": initData } : {};
}

/** Opens Telegram's share sheet; the user picks a chat and confirms there. */
export function shareInTelegram(url: string, text: string): void {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  const app = window.Telegram?.WebApp;
  if (app?.openTelegramLink) app.openTelegramLink(shareUrl);
  else window.open(shareUrl, "_blank", "noopener,noreferrer");
}

export async function readApiError(response: Response, fallback: string): Promise<string> {
  // Not connected yet, or the launch data expired: both are fixed from the chat.
  if (response.status === 401) return "Open the bot chat, tap Start, then open this again.";
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}
