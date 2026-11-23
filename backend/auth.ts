// Signing in (docs/cloud-plan.md, "Signing in"): email and password always
// (a self-hosted server may have nothing else); email links, Google and GitHub
// when they're configured. Without an email service, links and password
// resets are written to the server's log (development only).
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { haveIBeenPwned, magicLink } from "better-auth/plugins";
import type { CloudDb } from "./db/index";
import * as schema from "./db/schema";
import type { Mailer } from "./email";

export interface OAuthApp {
  clientId: string;
  clientSecret: string;
}

export interface AuthConfig {
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  mailer: Mailer;
  google?: OAuthApp;
  github?: OAuthApp;
  // Refuse passwords known from data breaches (asks the Have I Been Pwned
  // range API with the first 5 characters of the password's SHA-1 only).
  checkLeakedPasswords?: boolean;
}

export interface SignInMethods {
  password: true;
  emailLink: boolean;
  resetPassword: boolean;
  google: boolean;
  github: boolean;
}

const dev = process.env.NODE_ENV !== "production";

export function signInMethods(cfg: AuthConfig): SignInMethods {
  // Links in the log are only useful to whoever reads the log: development.
  const email = cfg.mailer.configured || dev;
  return { password: true, emailLink: email, resetPassword: email, google: Boolean(cfg.google), github: Boolean(cfg.github) };
}

export function createAuth(db: CloudDb, cfg: AuthConfig) {
  const { mailer } = cfg;
  const methods = signInMethods(cfg);
  return betterAuth({
    secret: cfg.secret,
    baseURL: cfg.baseURL,
    basePath: "/api/v1/auth",
    trustedOrigins: (request) => {
      const origin = request?.headers.get("origin");
      if (origin && dev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
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
      minPasswordLength: 8,
      ...(methods.resetPassword
        ? {
            sendResetPassword: async ({ user, url }) => {
              await mailer.send({
                to: user.email,
                subject: "Reset your Odaja password",
                text: `Someone (hopefully you) asked to reset the password for ${user.email}.\n\nChoose a new one here (the link works for an hour):\n${url}\n\nIf it wasn't you, ignore this email.`,
              });
            },
          }
        : {}),
    },
    ...(mailer.configured
      ? {
          emailVerification: {
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            sendVerificationEmail: async ({ user, url }) => {
              await mailer.send({ to: user.email, subject: "Confirm your email for Odaja", text: `Confirm your email address:\n${url}` });
            },
          },
        }
      : {}),
    socialProviders: {
      ...(cfg.google ? { google: cfg.google } : {}),
      ...(cfg.github ? { github: cfg.github } : {}),
    },
    plugins: [
      ...(methods.emailLink
        ? [
            magicLink({
              expiresIn: 15 * 60,
              sendMagicLink: async ({ email, url }) => {
                await mailer.send({ to: email, subject: "Your Odaja sign-in link", text: `Sign in to Odaja (the link works for 15 minutes):\n${url}\n\nIf you didn't ask for it, ignore this email.` });
              },
            }),
          ]
        : []),
      ...(cfg.checkLeakedPasswords ? [haveIBeenPwned({ customPasswordCompromisedMessage: "This password has appeared in a data breach. Please choose another." })] : []),
    ],
    // On in development too, so it's tried before it matters. Better Auth's
    // own stricter rules for sign-in and sign-up apply on top.
    rateLimit: { enabled: true, window: 60, max: 100 },
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
