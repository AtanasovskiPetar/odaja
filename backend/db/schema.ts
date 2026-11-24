import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// --- better-auth core tables ------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// --- Odaja projects ---------------------------------------------------------
// A home's files are stored by content: each content once, under its SHA-256
// (`blobs/<hash>`, see storage/content.ts), and the home is a manifest saying
// which content each path has. A version is a saved manifest, so it costs only
// the files that changed, and restoring one copies nothing.

export interface ManifestEntry {
  hash: string;
  size: number;
  type: string;
  // Stored gzip-compressed (JSON and other text).
  gz?: boolean;
}
export type Manifest = Record<string, ManifestEntry>;

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    manifest: jsonb("manifest").$type<Manifest>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [index("projects_owner_idx").on(table.ownerId)],
);

export type ProjectRow = typeof projects.$inferSelect;

export type VersionReason = "autosave" | "named" | "before-ai" | "before-restore";

export const versions = pgTable(
  "versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    manifest: jsonb("manifest").$type<Manifest>().notNull(),
    reason: text("reason").$type<VersionReason>().notNull(),
    label: text("label"),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("versions_project_idx").on(table.projectId, table.createdAt)],
);

export type VersionRow = typeof versions.$inferSelect;

// --- AI on our key: credits --------------------------------------------------
// Amounts are in thousandths of a credit (integers), so a cheap reply costing
// 0.04 credits is charged exactly. How many credits a dollar of model cost is,
// and how many an account gets, are configuration (backend/ai/config.ts).

// One per account: what it can spend now (`balance`), what running replies
// have set aside (`held`, moved back when each step is settled) and what it
// spent this month (for the hard ceiling).
export const creditAccounts = pgTable("credit_accounts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  held: bigint("held", { mode: "number" }).notNull().default(0),
  starterGranted: boolean("starter_granted").notNull().default(false),
  // The month ("2026-11") the monthly allowance was last given.
  allowanceMonth: text("allowance_month"),
  // Spent in `spentMonth` (for the ceiling), reset when the month changes.
  spentMonth: text("spent_month"),
  spent: bigint("spent", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CreditReason = "starter" | "monthly" | "grant" | "top-up" | "ai";

// Every change of a balance, with the balance after it.
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    change: bigint("change", { mode: "number" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    reason: text("reason").$type<CreditReason>().notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("credit_ledger_user_idx").on(table.userId, table.createdAt)],
);

// What each AI reply used and cost us, for pricing and abuse checks.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    steps: integer("steps").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    cacheWriteTokens: integer("cache_write_tokens").notNull(),
    // Our cost in millionths of a dollar, and the credits charged (thousandths).
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull(),
    charged: bigint("charged", { mode: "number" }).notNull(),
    outcome: text("outcome").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("ai_usage_user_idx").on(table.userId, table.createdAt)],
);
