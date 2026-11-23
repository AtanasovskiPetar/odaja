import { describe, expect, test } from "bun:test";
import { blobKey, getContent, putContent } from "./content";
import type { BlobStore } from "./s3";

// A store in memory, with each object's last write time.
function memoryStore() {
  const objects = new Map<string, { body: Uint8Array; at: number }>();
  let puts = 0;
  const store = {
    async get(key: string) {
      const o = objects.get(key);
      return o ? { body: o.body } : null;
    },
    async put(key: string, body: Uint8Array | string) {
      puts++;
      objects.set(key, { body: typeof body === "string" ? new TextEncoder().encode(body) : body, at: Date.now() });
      return {};
    },
    async del(key: string) {
      objects.delete(key);
    },
    async modified(key: string) {
      return objects.get(key)?.at ?? null;
    },
  } as unknown as BlobStore;
  return { store, objects, puts: () => puts };
}

describe("putContent", () => {
  test("stores text compressed, once, and reads it back", async () => {
    const { store, puts } = memoryStore();
    const bytes = new TextEncoder().encode(JSON.stringify({ name: "Flat" }));
    const entry = await putContent(store, "project.json", bytes);
    await putContent(store, "copy.json", bytes);
    expect(entry.gz).toBe(true);
    expect(puts()).toBe(1);
    expect(new TextDecoder().decode((await getContent(store, entry))!)).toBe('{"name":"Flat"}');
  });

  test("writes old content again, so the cleanup won't take it while a save uses it", async () => {
    const { store, objects, puts } = memoryStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const entry = await putContent(store, "assets/a.glb", bytes);
    objects.get(blobKey(entry))!.at = Date.now() - 2 * 3_600_000;
    await putContent(store, "assets/a.glb", bytes);
    expect(puts()).toBe(2);
    expect(Date.now() - (await store.modified(blobKey(entry)))!).toBeLessThan(1000);
  });
});
