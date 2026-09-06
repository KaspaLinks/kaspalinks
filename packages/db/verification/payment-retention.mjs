import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

// Supply an independently installed PGlite module; this verification adds no
// application dependency and never reads DATABASE_URL or connects to a server.
// Example: node packages/db/verification/payment-retention.mjs /tmp/pg-check/node_modules/@electric-sql/pglite/dist/index.js
const modulePath = process.argv[2];
if (!modulePath) throw new Error("Pass the path to an installed @electric-sql/pglite module.");
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);

const root = fileURLToPath(new URL("../../../", import.meta.url));
const migrationRoot = `${root}/packages/db/prisma/migrations`;
const newest = "20260905130000_preserve_payment_events_on_deletion";
const db = new PGlite();
try {
  const migrations = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of migrations.filter((name) => name !== newest)) {
    await db.exec(await readFile(`${migrationRoot}/${name}/migration.sql`, "utf8"));
  }
  await db.exec(`
    INSERT INTO "Creator" ("id", "username", "tokenHash", "updatedAt")
      VALUES ('review-creator', 'review_synthetic', repeat('0',64), CURRENT_TIMESTAMP);
    INSERT INTO "Action" ("id", "publicId", "type", "title", "recipientAddress", "amountSompi", "creatorId", "updatedAt")
      VALUES ('review-action', 'review-public', 'kaspa.tip', 'Synthetic review', 'synthetic-address', 100000000, 'review-creator', CURRENT_TIMESTAMP);
    INSERT INTO "PaymentRequest" ("id", "actionId", "status", "recipientAddress", "amountSompi", "network", "expiresAt", "updatedAt", "txId")
      VALUES ('review-payment', 'review-action', 'CONFIRMED', 'synthetic-address', 100000000, 'MAINNET', CURRENT_TIMESTAMP + INTERVAL '15 minutes', CURRENT_TIMESTAMP, repeat('a',64));
    INSERT INTO "PaymentEvent" ("id", "paymentRequestId", "actionId", "creatorId", "amountSompi", "txId", "occurredAt")
      VALUES ('review-event', 'review-payment', 'review-action', 'review-creator', 100000000, repeat('a',64), CURRENT_TIMESTAMP);
  `);
  await assert.rejects(
    db.exec(`DELETE FROM "PaymentRequest" WHERE "id"='review-payment'`),
    (error) =>
      ["23001", "23503"].includes(error.code) &&
      error.constraint === "PaymentEvent_paymentRequestId_fkey",
  );
  console.log("PASS: original schema reproduces profile-deletion foreign-key restriction failure");
  await db.exec(await readFile(`${migrationRoot}/${newest}/migration.sql`, "utf8"));
  assert.equal(
    (await db.query(`SELECT count(*)::int AS count FROM "PaymentEvent"`)).rows[0].count,
    1,
  );

  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec(
        `INSERT INTO "AuditLog" ("id","event","creatorId") VALUES ('rollback-audit','creator.deleted','review-creator')`,
      );
      await tx.exec(`DELETE FROM "PaymentRequest" WHERE "id"='review-payment'`);
      throw new Error("synthetic rollback");
    }),
    /synthetic rollback/,
  );
  assert.equal(
    (await db.query(`SELECT count(*)::int AS count FROM "AuditLog" WHERE "id"='rollback-audit'`))
      .rows[0].count,
    0,
  );
  assert.equal(
    (await db.query(`SELECT count(*)::int AS count FROM "PaymentRequest"`)).rows[0].count,
    1,
  );
  console.log("PASS: deletion failure rolls back both audit and resource deletion");

  await db.transaction(async (tx) => {
    await tx.exec(
      `INSERT INTO "AuditLog" ("id","event","creatorId") VALUES ('review-audit','creator.deleted','review-creator')`,
    );
    await tx.exec(`DELETE FROM "PaymentRequest" WHERE "actionId"='review-action'`);
    await tx.exec(`DELETE FROM "Action" WHERE "id"='review-action'`);
    await tx.exec(`DELETE FROM "Creator" WHERE "id"='review-creator'`);
  });
  const event = (
    await db.query(
      `SELECT "paymentRequestId", "actionId", "creatorId", "amountSompi"::text AS "amountSompi", "txId" FROM "PaymentEvent" WHERE "id"='review-event'`,
    )
  ).rows[0];
  assert.deepEqual(event, {
    paymentRequestId: null,
    actionId: null,
    creatorId: null,
    amountSompi: "100000000",
    txId: "a".repeat(64),
  });
  const audit = (
    await db.query(`SELECT "creatorId", "event" FROM "AuditLog" WHERE "id"='review-audit'`)
  ).rows[0];
  assert.deepEqual(audit, { creatorId: null, event: "creator.deleted" });
  for (const table of ["Creator", "Action", "PaymentRequest"]) {
    assert.equal(
      (await db.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows[0].count,
      0,
    );
  }
  console.log(
    "PASS: migrated deletion succeeds, payment facts and audit survive with null references",
  );
  console.log(`PASS: all ${migrations.length} repository migrations executed on PostgreSQL WASM`);
} finally {
  await db.close();
}
