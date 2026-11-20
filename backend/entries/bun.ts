import { createCloudApp } from "../app";
import { createAuth } from "../auth";
import { createDb } from "../db/index";
import { createS3BlobStore } from "../storage/s3";

const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL ?? "postgres://odaja:odaja_dev_password@localhost:5432/odaja";
const authSecret = process.env.BETTER_AUTH_SECRET ?? "dev-only-change-me-to-a-long-random-secret-string";
const authUrl = process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`;
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const db = createDb(databaseUrl);
const blobs = createS3BlobStore({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:2600",
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? "http://localhost:2600",
  region: process.env.S3_REGION ?? "us-east-1",
  bucket: process.env.S3_BUCKET ?? "odaja",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "odaja_access_key",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "odaja_secret_key",
});

const auth = createAuth(db, {
  secret: authSecret,
  baseURL: authUrl,
  trustedOrigins: corsOrigins,
});

const app = createCloudApp({ db, blobs, auth, corsOrigins });

blobs.ensureBucket().catch((err) => {
  console.warn("[odaja-cloud] Could not ensure S3 bucket on startup (is ferdzo/fs running?):", (err as Error).message);
});

declare const Bun: {
  serve(opts: { port: number; fetch: (req: Request) => Response | Promise<Response> }): { port: number };
};

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`[odaja-cloud] listening on http://localhost:${server.port}`);
