import { describe, expect, it, vi } from "vitest";

import { TelegramApiClient } from "./telegram-api.ts";

describe("TelegramApiClient", () => {
  it("registers the visible bot command menu", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const client = new TelegramApiClient("test-token", fetcher);

    await expect(
      client.setMyCommands([{ command: "help", description: "Show all commands" }]),
    ).resolves.toBe(true);

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/setMyCommands",
      expect.objectContaining({
        body: JSON.stringify({
          commands: [{ command: "help", description: "Show all commands" }],
        }),
        method: "POST",
      }),
    );
  });
});
