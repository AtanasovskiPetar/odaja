import { createCloudApp } from "../app";
import { createAuth, signInMethods, type AuthConfig, type OAuthApp } from "../auth";
import { createDb } from "../db/index";
import { createMailer } from "../email";
import { createHomeEvents } from "../events";
import { collectGarbage, createHomes, thinVersions } from "../homes";
import { createS3BlobStore } from "../storage/s3";

const env = process.env;
const port = Number(env.PORT ?? 8787);
const databaseUrl = env.DATABASE_URL ?? "postgres://odaja:odaja_dev_password@localhost:5432/odaja";
const authSecret = env.BETTER_AUTH_SECRET ?? "dev-only-change-me-to-a-long-random-secret-string";
const authUrl = env.BETTER_AUTH_URL ?? `http://localhost:${port}`;
const corsOrigins = (env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const oauth = (id?: string, secret?: string): OAuthApp | undefined => (id && secret ? { clientId: id, clientSecret: secret } : undefined);

const db = createDb(databaseUrl);
const blobs = createS3BlobStore({
  endpoint: env.S3_ENDPOINT ?? "http://localhost:2600",
  publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT ?? "http://localhost:2600",
  region: env.S3_REGION ?? "us-east-1",
  bucket: env.S3_BUCKET ?? "odaja",
  accessKeyId: env.S3_ACCESS_KEY_ID ?? "odaja_access_key",
  secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "odaja_secret_key",
});

const authConfig: AuthConfig = {
  secret: authSecret,
  baseURL: authUrl,
  trustedOrigins: corsOrigins,
  mailer: createMailer({ resendApiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }),
  google: oauth(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
  github: oauth(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
  checkLeakedPasswords: env.AUTH_CHECK_LEAKED_PASSWORDS === "true",
};

const app = createCloudApp({
  db,
  blobs,
  auth: createAuth(db, authConfig),
  signInMethods: signInMethods(authConfig),
  homes: createHomes(db, blobs),
  events: createHomeEvents(),
  corsOrigins,
});

blobs.ensureBucket().catch((err) => {
  console.warn("[odaja-cloud] Could not ensure S3 bucket on startup (is ferdzo/fs running?):", (err as Error).message);
});

// Every hour: thin old versions, then delete content nothing uses any more.
const keepDays = env.VERSION_KEEP_DAYS ? Number(env.VERSION_KEEP_DAYS) : undefined;
const tidy = async () => {
  try {
    const dropped = await thinVersions(db, Date.now(), keepDays);
    const deleted = await collectGarbage(db, blobs);
    if (dropped || deleted) console.log(`[odaja-cloud] tidied: ${dropped} old versions, ${deleted} unused files`);
  } catch (err) {
    console.warn("[odaja-cloud] tidying failed:", (err as Error).message);
  }
};
setInterval(tidy, 60 * 60_000);
setTimeout(tidy, 60_000);

declare const Bun: {
  serve(opts: { port: number; idleTimeout?: number; fetch: (req: Request) => Response | Promise<Response> }): { port: number };
};

const server = Bun.serve({
  port,
  // Change streams ping every 20 s; the default 10 s would cut them off.
  idleTimeout: 60,
  fetch: app.fetch,
});

console.log(`[odaja-cloud] listening on http://localhost:${server.port}`);
