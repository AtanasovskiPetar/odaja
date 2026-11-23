// Files stored by content: each content once, under its SHA-256, never changed.
// Text (JSON, Markdown) is kept gzip-compressed, about ten times smaller.
// Web standards only (crypto.subtle, CompressionStream), so it runs on Bun,
// Node and Workers alike.
import type { ManifestEntry } from "../db/schema";
import type { BlobStore } from "./s3";

const TEXT = /\.(json|md|txt|svg|csv)$/i;

export function contentTypeFor(rel: string): string {
  const lower = rel.toLowerCase();
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export const blobKey = (entry: Pick<ManifestEntry, "hash" | "gz">) => `blobs/${entry.hash}${entry.gz ? ".gz" : ""}`;

// Content stored this recently is never cleaned up (collectGarbage in homes.ts).
export const FRESH_MS = 24 * 3_600_000;

// Stores the content (if it isn't stored yet) and returns its manifest entry.
// Content stored over an hour ago is written again: it may be unused and about
// to be cleaned up, and writing it makes it fresh.
export async function putContent(blobs: BlobStore, rel: string, bytes: Uint8Array): Promise<ManifestEntry> {
  const entry: ManifestEntry = { hash: await sha256(bytes), size: bytes.byteLength, type: contentTypeFor(rel) };
  if (TEXT.test(rel)) entry.gz = true;
  const key = blobKey(entry);
  const stored = await blobs.modified(key);
  if (stored === null || Date.now() - stored > 3_600_000) {
    const body = entry.gz ? await pipe(bytes, new CompressionStream("gzip")) : bytes;
    await blobs.put(key, body, { contentType: entry.gz ? "application/gzip" : entry.type });
  }
  return entry;
}

export async function getContent(blobs: BlobStore, entry: ManifestEntry): Promise<Uint8Array | null> {
  const obj = await blobs.get(blobKey(entry));
  if (!obj) return null;
  return entry.gz ? pipe(obj.body, new DecompressionStream("gzip")) : obj.body;
}

// The fingerprint as an HTTP ETag, and back. `If-Match: *` means "any".
export const etagOf = (hash: string) => `"${hash}"`;
export function parseEtag(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const value = header.trim().replace(/^W\//, "");
  return value === "*" ? "*" : value.replace(/^"|"$/g, "");
}
