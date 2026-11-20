import { AwsClient } from "aws4fetch";

export interface BlobObject {
  body: Uint8Array;
  contentType?: string;
  etag?: string;
}

export interface BlobStore {
  get(key: string): Promise<BlobObject | null>;
  put(key: string, body: Uint8Array | string, opts?: { contentType?: string }): Promise<{ etag?: string }>;
  del(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  presignGet(key: string, expiresInSec?: number): Promise<string>;
  ensureBucket(): Promise<void>;
}

export interface S3Config {
  endpoint: string;
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function encodeKey(key: string): string {
  return key
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseListKeys(xml: string): { keys: string[]; nextToken?: string } {
  const keys: string[] = [];
  const keyRe = /<Key>([^<]+)<\/Key>/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(xml))) keys.push(decodeXml(m[1]!));
  const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
  return { keys, nextToken: next ? decodeXml(next) : undefined };
}

// Single S3-compatible BlobStore using Web Standards (aws4fetch).
// Works identically against ferdzo/fs (:2600), Cloudflare R2, MinIO, and AWS S3,
// on Bun, Node, Cloudflare Workers, and AWS Lambda.
export function createS3BlobStore(cfg: S3Config): BlobStore {
  const endpoint = cfg.endpoint.replace(/\/+$/, "");
  const publicEndpoint = (cfg.publicEndpoint ?? cfg.endpoint).replace(/\/+$/, "");
  const bucket = encodeURIComponent(cfg.bucket);
  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
    service: "s3",
  });

  const objectUrl = (base: string, key: string) => `${base}/${bucket}/${encodeKey(key)}`;

  return {
    async ensureBucket() {
      const url = `${endpoint}/${bucket}`;
      const head = await aws.fetch(url, { method: "HEAD" });
      if (head.ok) return;
      const put = await aws.fetch(url, { method: "PUT" });
      // 409 BucketAlreadyOwnedByYou / BucketAlreadyExists is fine.
      if (!put.ok && put.status !== 409) {
        throw new Error(`Failed to ensure S3 bucket "${cfg.bucket}": ${put.status} ${await put.text()}`);
      }
    },

    async get(key) {
      const res = await aws.fetch(objectUrl(endpoint, key), { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 GET ${key} failed: ${res.status}`);
      return {
        body: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("Content-Type") ?? undefined,
        etag: res.headers.get("ETag") ?? undefined,
      };
    },

    async put(key, body, opts) {
      const payload = typeof body === "string" ? new TextEncoder().encode(body) : body;
      const res = await aws.fetch(objectUrl(endpoint, key), {
        method: "PUT",
        headers: {
          ...(opts?.contentType ? { "Content-Type": opts.contentType } : {}),
          "Content-Length": String(payload.byteLength),
        },
        body: payload.slice().buffer,
      });
      if (!res.ok) throw new Error(`S3 PUT ${key} failed: ${res.status} ${await res.text()}`);
      return { etag: res.headers.get("ETag") ?? undefined };
    },

    async del(key) {
      const res = await aws.fetch(objectUrl(endpoint, key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE ${key} failed: ${res.status}`);
    },

    async list(prefix) {
      const all: string[] = [];
      let token: string | undefined;
      for (;;) {
        const params = new URLSearchParams({ "list-type": "2", prefix });
        if (token) params.set("continuation-token", token);
        const res = await aws.fetch(`${endpoint}/${bucket}?${params.toString()}`, { method: "GET" });
        if (res.status === 404) return [];
        if (!res.ok) throw new Error(`S3 LIST ${prefix} failed: ${res.status}`);
        const { keys, nextToken } = parseListKeys(await res.text());
        all.push(...keys);
        if (!nextToken) break;
        token = nextToken;
      }
      return all;
    },

    async presignGet(key, expiresInSec = 900) {
      const url = new URL(objectUrl(publicEndpoint, key));
      url.searchParams.set("X-Amz-Expires", String(expiresInSec));
      const signed = await aws.sign(url.toString(), {
        method: "GET",
        aws: { signQuery: true },
      });
      return signed.url;
    },
  };
}
