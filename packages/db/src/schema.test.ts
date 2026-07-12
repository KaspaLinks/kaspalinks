import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("packages/db/prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "packages/db/prisma/migrations/20260512180000_init/migration.sql",
  "utf8",
);

describe("Prisma schema", () => {
  it("uses PostgreSQL and the Prisma 7 client generator", () => {
    expect(schema).toContain('provider = "postgresql"');
    expect(schema).toMatch(/provider\s+=\s+"prisma-client"/);
    expect(schema).toMatch(/output\s+=\s+"..\/src\/generated\/prisma"/);
  });

  it("defines the initial database models", () => {
    expect(schema).toContain("model Creator");
    expect(schema).toContain("model Action");
    expect(schema).toContain("model PaymentRequest");
    expect(schema).toContain("model AuditLog");
  });

  it("links creator-owned Actions by slug without breaking publicId links", () => {
    expect(schema).toContain("creatorId");
    expect(schema).toContain("deletedAt");
    expect(schema).toContain("slug");
    expect(schema).toContain("@@unique([creatorId, slug])");
    expect(schema).toMatch(/publicId\s+String\s+@unique @default\(cuid\(\)\)/);
  });

  it("keeps payment request statuses aligned with the public wire format", () => {
    for (const status of ["PENDING", "CONFIRMED", "EXPIRED", "FAILED"]) {
      expect(schema).toContain(status);
    }
  });

  it("stores sompi amounts as BigInt fields", () => {
    expect(schema).toMatch(/amountSompi\s+BigInt/);
  });
});

describe("initial migration", () => {
  it("creates tables for the core data models", () => {
    expect(migration).toContain('CREATE TABLE "Action"');
    expect(migration).toContain('CREATE TABLE "PaymentRequest"');
    expect(migration).toContain('CREATE TABLE "AuditLog"');
  });

  it("does not expose app or Postgres networking concerns in SQL", () => {
    expect(migration).not.toContain("LISTEN");
    expect(migration).not.toContain("0.0.0.0");
  });
});
