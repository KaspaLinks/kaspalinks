/** Hands the address from the home page's quick start to the new-link form. */
export const QUICK_RECIPIENT_STORAGE_KEY = "kaspalinks.quickRecipient";

/** Reads the handed-over address once and forgets it. */
export function takeQuickRecipient(): string {
  try {
    const value = window.sessionStorage.getItem(QUICK_RECIPIENT_STORAGE_KEY) ?? "";
    window.sessionStorage.removeItem(QUICK_RECIPIENT_STORAGE_KEY);
    return value.trim();
  } catch {
    return "";
  }
}
