import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.ts";

type GlobalPrisma = typeof globalThis & {
  kaspaActionsPrisma?: PrismaClient;
};

export function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to create the Prisma client.");
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({ adapter });
}

function resolvePrisma(): PrismaClient {
  const globalForPrisma = globalThis as GlobalPrisma;

  if (!globalForPrisma.kaspaActionsPrisma) {
    globalForPrisma.kaspaActionsPrisma = createPrismaClient();
  }

  return globalForPrisma.kaspaActionsPrisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = resolvePrisma() as unknown as Record<string | symbol, unknown>;
    const value = instance[property];
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
