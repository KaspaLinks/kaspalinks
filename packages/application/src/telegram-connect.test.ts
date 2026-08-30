import type { PrismaClient } from "@kaspa-actions/db";
import { beforeEach, describe, expect, it } from "vitest";

import { actorContext } from "./actor.ts";
import {
  consumeTelegramConnectCodeTool,
  createTelegramConnectCodeTool,
  hashTelegramConnectCode,
} from "./telegram-connect.ts";

type CreatorRecord = { id: string; telegramBetaEnabled: boolean; username: string };
type CodeRecord = {
  codeHash: string;
  consumedAt: Date | null;
  createdAt: Date;
  creatorId: string;
  expiresAt: Date;
  id: string;
};
type AttemptRecord = {
  attempts: number;
  blockedUntil: Date | null;
  telegramUserId: string;
  windowStartedAt: Date;
};
type ConnectionRecord = {
  blockedAt: Date | null;
  creatorId: string;
  disabledReason: string | null;
  id: string;
  notificationsEnabled: boolean;
  telegramChatId: string;
  telegramUserId: string;
};
type AttemptUpsertArgs = {
  create: AttemptRecord;
  update: Partial<AttemptRecord>;
  where: { telegramUserId: string };
};
type CodeUpdateManyArgs = {
  data: Partial<CodeRecord>;
  where: { codeHash: string; consumedAt: null; expiresAt: { gt: Date } };
};
type ConnectionFindArgs = {
  where: { creatorId?: string; telegramUserId?: string };
};
type ConnectionUpsertArgs = {
  create: Omit<ConnectionRecord, "blockedAt" | "disabledReason" | "id" | "notificationsEnabled">;
  update: Partial<ConnectionRecord>;
  where: { creatorId: string };
};

function buildPrisma() {
  const creators = new Map<string, CreatorRecord>([
    ["creator-1", { id: "creator-1", telegramBetaEnabled: true, username: "alice" }],
    ["creator-2", { id: "creator-2", telegramBetaEnabled: true, username: "bob" }],
  ]);
  const codes = new Map<string, CodeRecord>();
  const attempts = new Map<string, AttemptRecord>();
  const connections = new Map<string, ConnectionRecord>();
  let nextId = 1;

  const tx = {
    auditLog: { create: async () => ({}) },
    telegramConnectAttempt: {
      deleteMany: async ({ where }: { where: { telegramUserId: string } }) => {
        attempts.delete(where.telegramUserId);
        return { count: 1 };
      },
      findUnique: async ({ where }: { where: { telegramUserId: string } }) =>
        attempts.get(where.telegramUserId) ?? null,
      upsert: async ({ create, update, where }: AttemptUpsertArgs) => {
        const current = attempts.get(where.telegramUserId);
        const value = current ? { ...current, ...update } : create;
        attempts.set(where.telegramUserId, value);
        return value;
      },
    },
    telegramConnectCode: {
      create: async ({ data }: { data: Omit<CodeRecord, "consumedAt" | "createdAt" | "id"> }) => {
        const value: CodeRecord = {
          ...data,
          consumedAt: null,
          createdAt: new Date(),
          id: `code-${nextId++}`,
        };
        codes.set(value.codeHash, value);
        return value;
      },
      deleteMany: async ({ where }: { where: { creatorId: string } }) => {
        let count = 0;
        for (const [hash, code] of codes) {
          if (code.creatorId === where.creatorId) {
            codes.delete(hash);
            count += 1;
          }
        }
        return { count };
      },
      findUnique: async ({ where }: { where: { codeHash: string } }) => {
        const code = codes.get(where.codeHash);
        if (!code) return null;
        return { ...code, creator: creators.get(code.creatorId) };
      },
      updateMany: async ({ data, where }: CodeUpdateManyArgs) => {
        const code = codes.get(where.codeHash);
        if (!code || code.consumedAt || code.expiresAt <= where.expiresAt.gt) return { count: 0 };
        Object.assign(code, data);
        return { count: 1 };
      },
    },
    telegramConnection: {
      findUnique: async ({ where }: ConnectionFindArgs) => {
        if (where.creatorId) return connections.get(where.creatorId) ?? null;
        return (
          [...connections.values()].find((item) => item.telegramUserId === where.telegramUserId) ??
          null
        );
      },
      upsert: async ({ create, update, where }: ConnectionUpsertArgs) => {
        const current = connections.get(where.creatorId);
        const value: ConnectionRecord = current
          ? { ...current, ...update }
          : {
              ...create,
              blockedAt: null,
              disabledReason: null,
              id: `connection-${nextId++}`,
              notificationsEnabled: false,
            };
        connections.set(where.creatorId, value);
        return value;
      },
    },
  };
  const prisma = {
    ...tx,
    $transaction: async (value: unknown) =>
      typeof value === "function"
        ? (value as (client: typeof tx) => unknown)(tx)
        : Promise.all(value as Promise<unknown>[]),
    creator: {
      findUnique: async ({ where }: { where: { id: string } }) => creators.get(where.id) ?? null,
    },
  } as unknown as PrismaClient;

  return { attempts, codes, connections, creators, prisma };
}

describe("Telegram connection codes", () => {
  let state: ReturnType<typeof buildPrisma>;
  const now = new Date("2026-08-30T10:00:00.000Z");

  beforeEach(() => {
    state = buildPrisma();
  });

  it("stores only a high-entropy hash and expires after ten minutes", async () => {
    const result = await createTelegramConnectCodeTool(
      state.prisma,
      actorContext("creator-1", "web"),
      now,
    );
    const stored = [...state.codes.values()][0];

    expect(result.code).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(stored?.codeHash).toBe(hashTelegramConnectCode(result.code));
    expect(stored?.codeHash).not.toContain(result.code);
    expect(result.expiresAt.getTime() - now.getTime()).toBe(10 * 60_000);
  });

  it("denies connection codes to creators outside the beta allowlist", async () => {
    state.creators.get("creator-1")!.telegramBetaEnabled = false;

    await expect(
      createTelegramConnectCodeTool(state.prisma, actorContext("creator-1", "web"), now),
    ).rejects.toMatchObject({ code: "TELEGRAM_BETA_DISABLED", status: 403 });
    expect(state.codes.size).toBe(0);
  });

  it("invalidates an earlier code and consumes the replacement once", async () => {
    const first = await createTelegramConnectCodeTool(
      state.prisma,
      actorContext("creator-1", "web"),
      now,
    );
    const second = await createTelegramConnectCodeTool(
      state.prisma,
      actorContext("creator-1", "web"),
      now,
    );
    await expect(
      consumeTelegramConnectCodeTool(
        state.prisma,
        { code: first.code, telegramChatId: "100", telegramUserId: "100" },
        now,
      ),
    ).rejects.toMatchObject({ code: "CONNECT_CODE_INVALID" });
    await expect(
      consumeTelegramConnectCodeTool(
        state.prisma,
        { code: second.code, telegramChatId: "100", telegramUserId: "100" },
        now,
      ),
    ).resolves.toMatchObject({ creator: { id: "creator-1" } });
    await expect(
      consumeTelegramConnectCodeTool(
        state.prisma,
        { code: second.code, telegramChatId: "100", telegramUserId: "100" },
        now,
      ),
    ).rejects.toMatchObject({ code: "CONNECT_CODE_INVALID" });
  });

  it("does not connect one Telegram user to a second creator", async () => {
    const first = await createTelegramConnectCodeTool(
      state.prisma,
      actorContext("creator-1", "web"),
      now,
    );
    await consumeTelegramConnectCodeTool(
      state.prisma,
      { code: first.code, telegramChatId: "100", telegramUserId: "100" },
      now,
    );
    const second = await createTelegramConnectCodeTool(
      state.prisma,
      actorContext("creator-2", "web"),
      now,
    );
    await expect(
      consumeTelegramConnectCodeTool(
        state.prisma,
        { code: second.code, telegramChatId: "100", telegramUserId: "100" },
        now,
      ),
    ).rejects.toMatchObject({ code: "TELEGRAM_ALREADY_CONNECTED" });
  });

  it("blocks repeated invalid-code guesses", async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(
        consumeTelegramConnectCodeTool(
          state.prisma,
          { code: `invalid-${attempt}`, telegramChatId: "999", telegramUserId: "999" },
          now,
        ),
      ).rejects.toMatchObject({ code: "CONNECT_CODE_INVALID" });
    }
    await expect(
      consumeTelegramConnectCodeTool(
        state.prisma,
        { code: "another-invalid", telegramChatId: "999", telegramUserId: "999" },
        now,
      ),
    ).rejects.toMatchObject({ code: "CONNECT_RATE_LIMITED" });
    expect(state.attempts.get("999")?.attempts).toBe(8);
  });
});
