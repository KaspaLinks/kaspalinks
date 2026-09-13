import { afterEach, describe, expect, it, vi } from "vitest";
import { savePrivateRecoveryFile, usesMobileRecoveryMenu } from "./private-recovery-download";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("private recovery export", () => {
  it.each([
    ["macos", "Macintosh", 0, false],
    ["tdesktop", "Android", 5, false],
    ["ios", "Macintosh", 0, true],
    ["android", "", 0, true],
    [undefined, "Macintosh", 5, true],
    ["webk", "iPhone", 1, true],
    [undefined, "Windows", 10, false],
  ])("selects the device menu for %s / %s", (platform, userAgent, maxTouchPoints, expected) => {
    expect(usesMobileRecoveryMenu(platform, { userAgent, maxTouchPoints })).toBe(expected);
  });

  function browser(platform: string, share = vi.fn().mockResolvedValue(undefined)) {
    vi.useFakeTimers();
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("window", { Telegram: { WebApp: { platform } }, setTimeout });
    vi.stubGlobal("navigator", {
      userAgent: "Macintosh",
      maxTouchPoints: 0,
      share,
      canShare: () => true,
    });
    vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: vi.fn() } });
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private-test");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const file = new File(["non-secret test fixture"], "test-recovery.json", {
      type: "application/json",
    });
    return { anchor, share, create, revoke, file };
  }

  // Telegram's desktop apps hand a blob URL to the operating system as an
  // external link. The OS has no handler for blob:, so nothing is saved while a
  // mocked anchor click still looks like success. An earlier version of this
  // test asserted exactly that click, which is how the failure shipped.
  it.each(["macos", "tdesktop", "weba", "unknown"])(
    "never starts a blob download inside Telegram on %s",
    async (platform) => {
      const b = browser(platform);
      expect(await savePrivateRecoveryFile(b.file, true)).toBe("copy");
      expect(b.create).not.toHaveBeenCalled();
      expect(b.anchor.click).not.toHaveBeenCalled();
      expect(b.share).not.toHaveBeenCalled();
    },
  );

  it("still downloads in an ordinary browser outside Telegram", async () => {
    const b = browser("macos");
    expect(await savePrivateRecoveryFile(b.file, false)).toBe("download");
    expect(b.anchor.download).toBe("test-recovery.json");
    expect(b.anchor.click).toHaveBeenCalledOnce();
    expect(b.revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(b.revoke).toHaveBeenCalledWith("blob:private-test");
  });

  it("waits for the mobile menu to finish", async () => {
    let finish!: () => void;
    const b = browser(
      "ios",
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    let done = false;
    const result = savePrivateRecoveryFile(b.file, true).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await result;
    expect(b.anchor.click).not.toHaveBeenCalled();
  });

  it("preserves cancellation without starting a download", async () => {
    const error = new DOMException("Cancelled", "AbortError");
    const b = browser("ios", vi.fn().mockRejectedValue(error));
    await expect(savePrivateRecoveryFile(b.file, true)).rejects.toBe(error);
    expect(b.create).not.toHaveBeenCalled();
  });

  it("asks for a manual copy when Telegram mobile cannot share files", async () => {
    const b = browser("android");
    vi.stubGlobal("navigator", { userAgent: "Android", maxTouchPoints: 1 });
    expect(await savePrivateRecoveryFile(b.file, true)).toBe("copy");
    expect(b.create).not.toHaveBeenCalled();
    expect(b.anchor.click).not.toHaveBeenCalled();
  });
});
