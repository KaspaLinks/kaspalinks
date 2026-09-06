import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath, URL } from "node:url";
// Isolated PostgreSQL/WASM verification; never reads DATABASE_URL.
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
try {
  const root = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));
  const migrations = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const name of migrations)
    await db.exec(await readFile(`${root}/${name}/migration.sql`, "utf8"));
  await db.exec(`
    INSERT INTO "Creator" (id,username,"tokenHash","updatedAt") VALUES ('c1','fixture_creator','fixture',CURRENT_TIMESTAMP);
    INSERT INTO "Giveaway" (id,"publicId","creatorId",title,"amountSompi","closesAt","drawSeedHex","drawCommitment","updatedAt") VALUES ('g1','public1','c1','Fixture',100000000,CURRENT_TIMESTAMP,'fixture-seed','fixture-commitment',CURRENT_TIMESTAMP);
    INSERT INTO "TelegramGiveawaySubscription" (id,"giveawayId","telegramUserId","telegramChatId","updatedAt") VALUES ('s1','g1','123','123',CURRENT_TIMESTAMP);
    INSERT INTO "TelegramOutbox" (id,"subscriptionId","dedupeKey",kind,payload,"updatedAt") VALUES ('o1','s1','giveaway-result:s1','giveaway.result','{}',CURRENT_TIMESTAMP);
  `);
  await assert.rejects(
    db.exec(
      `INSERT INTO "TelegramGiveawaySubscription" (id,"giveawayId","telegramUserId","telegramChatId","updatedAt") VALUES ('s2','g1','123','123',CURRENT_TIMESTAMP)`,
    ),
    (e) => e.code === "23505",
  );
  await assert.rejects(
    db.exec(
      `INSERT INTO "TelegramOutbox" (id,"subscriptionId","dedupeKey",kind,payload,"updatedAt") VALUES ('o2','s1','giveaway-result:s1','giveaway.result','{}',CURRENT_TIMESTAMP)`,
    ),
    (e) => e.code === "23505",
  );
  await db.exec(
    `INSERT INTO "AgentIntentDraft" (id,"creatorId","telegramUserId",intent,payload,"expiresAt","sourceUpdateId","updatedAt") VALUES ('d1','c1','123','prepare_giveaway','{}',CURRENT_TIMESTAMP,'telegram:1',CURRENT_TIMESTAMP)`,
  );
  await assert.rejects(
    db.exec(
      `INSERT INTO "AgentIntentDraft" (id,"creatorId","telegramUserId",intent,payload,"expiresAt","sourceUpdateId","updatedAt") VALUES ('d2','c1','123','prepare_giveaway','{}',CURRENT_TIMESTAMP,'telegram:1',CURRENT_TIMESTAMP)`,
    ),
    (e) => e.code === "23505",
  );
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec(
        `UPDATE "TelegramGiveawaySubscription" SET "resultQueuedAt"=CURRENT_TIMESTAMP WHERE id='s1'`,
      );
      throw new Error("rollback fixture");
    }),
    /rollback fixture/,
  );
  assert.equal(
    (await db.query(`SELECT "resultQueuedAt" FROM "TelegramGiveawaySubscription" WHERE id='s1'`))
      .rows[0].resultQueuedAt,
    null,
  );
  await db.exec(`DELETE FROM "Giveaway" WHERE id='g1'`);
  assert.equal(
    (await db.query(`SELECT count(*)::int AS n FROM "TelegramGiveawaySubscription"`)).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query(`SELECT "subscriptionId" FROM "TelegramOutbox" WHERE id='o1'`)).rows[0]
      .subscriptionId,
    null,
  );
  console.log(
    `PASS: ${migrations.length} migrations; subscription/update/outbox uniqueness; rollback; giveaway deletion cascade and detached outbox`,
  );
} finally {
  await db.close();
}
