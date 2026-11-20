import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { CloudDb } from "./db/index";
import * as schema from "./db/schema";

export interface AuthConfig {
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
}

export function createAuth(db: CloudDb, cfg: AuthConfig) {
  return betterAuth({
    secret: cfg.secret,
    baseURL: cfg.baseURL,
    basePath: "/api/v1/auth",
    trustedOrigins: (request) => {
      const origin = request?.headers.get("origin");
      if (origin && process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return [...cfg.trustedOrigins, origin];
      }
      return cfg.trustedOrigins;
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
    },
    session: {
      // Rolling 30-day sessions: refreshed automatically on activity every 24h.
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
  });
}

export type CloudAuth = ReturnType<typeof createAuth>;
