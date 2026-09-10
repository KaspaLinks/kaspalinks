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

/** Private bytes stay in this browser; never use a remotely hosted Telegram download URL. */
export async function savePrivateRecoveryFile(
  file: File,
  telegram: boolean,
): Promise<"menu" | "download"> {
  if (
    telegram &&
    usesMobileRecoveryMenu(window.Telegram?.WebApp?.platform, navigator) &&
    typeof navigator.share === "function" &&
    navigator.canShare?.({ files: [file] })
  ) {
    await navigator.share({ files: [file], title: "KaspaLinks prize recovery" });
    return "menu";
  }
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
