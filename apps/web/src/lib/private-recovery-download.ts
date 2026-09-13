/** Native Telegram platform wins over user-agent emulation (including iPad desktop mode). */
export function usesMobileRecoveryMenu(
  platform: string | undefined,
  device: Pick<Navigator, "userAgent" | "maxTouchPoints">,
): boolean {
  if (platform === "ios" || platform === "android") return true;
  if (platform && platform !== "unknown" && !platform.startsWith("web")) return false;
  return (
    /Android|iPhone|iPad|iPod/i.test(device.userAgent) ||
    (/Macintosh/i.test(device.userAgent) && device.maxTouchPoints > 1)
  );
}

/**
 * Save the private recovery file where the platform can actually save it.
 *
 * Private bytes stay in this browser; never use a remotely hosted Telegram
 * download URL. That rules out Telegram's own download API, which needs the
 * file on a server, and this file holds a private key.
 *
 * Inside Telegram, a file is only saved through the native share sheet. A blob
 * download is not an option there: Telegram's desktop app treats the click as
 * an external link and hands `blob:` to the operating system, which has no
 * handler for it. Nothing is saved, and the page cannot tell. So when the share
 * sheet is unavailable, this returns "copy" without attempting a download, and
 * the caller shows the recovery text for the creator to store by hand.
 */
export async function savePrivateRecoveryFile(
  file: File,
  telegram: boolean,
): Promise<"menu" | "download" | "copy"> {
  if (
    telegram &&
    usesMobileRecoveryMenu(window.Telegram?.WebApp?.platform, navigator) &&
    typeof navigator.share === "function" &&
    navigator.canShare?.({ files: [file] })
  ) {
    await navigator.share({ files: [file], title: "KaspaLinks prize recovery" });
    return "menu";
  }
  if (telegram) return "copy";
  const href = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  try {
    anchor.href = href;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Give the browser/webview time to consume the Blob before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }
  return "download";
}
