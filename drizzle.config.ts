import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./backend/db/schema.ts",
  out: "./backend/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://odaja:odaja_dev_password@localhost:5432/odaja",
  },
});
