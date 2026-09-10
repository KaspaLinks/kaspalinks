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

  it("downloads on Telegram macOS even when file sharing is supported", async () => {
    const b = browser("macos");
    expect(await savePrivateRecoveryFile(b.file, true)).toBe("download");
    expect(b.share).not.toHaveBeenCalled();
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

  it("falls back to downloading when mobile file sharing is unsupported", async () => {
    const b = browser("android");
    vi.stubGlobal("navigator", { userAgent: "Android", maxTouchPoints: 1 });
    expect(await savePrivateRecoveryFile(b.file, true)).toBe("download");
    expect(b.anchor.click).toHaveBeenCalledOnce();
  });
});
