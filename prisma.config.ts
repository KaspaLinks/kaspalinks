import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    path: "packages/db/prisma/migrations",
    seed: "tsx packages/db/src/seed.ts",
  },
  schema: "packages/db/prisma/schema.prisma",
});
