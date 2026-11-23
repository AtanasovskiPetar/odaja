import { describe, expect, test } from "bun:test";
import type { Manifest } from "./db/schema";
import { sameHome, versionsToDrop } from "./homes";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 10, 23, 12);
const v = (id: string, ago: number, reason: "autosave" | "named" = "autosave") => ({ id, createdAt: new Date(now - ago), reason });

describe("versionsToDrop", () => {
  test("keeps everything from the last day", () => {
    expect(versionsToDrop([v("a", HOUR), v("b", 2 * HOUR), v("c", 23 * HOUR)], now)).toEqual([]);
  });

  test("keeps the newest of each hour for a week, then of each day", () => {
    const list = [
      v("h1-new", 2 * DAY + 10 * 60_000),
      v("h1-old", 2 * DAY + 20 * 60_000),
      v("other-hour", 2 * DAY + 2 * HOUR),
      v("d1-new", 10 * DAY + HOUR),
      v("d1-old", 10 * DAY + 3 * HOUR),
    ];
    expect(versionsToDrop(list, now).sort()).toEqual(["d1-old", "h1-old"]);
  });

  test("named versions are always kept, and keepDays drops the rest", () => {
    const list = [v("named", 400 * DAY, "named"), v("old", 400 * DAY), v("recent", 3 * DAY)];
    expect(versionsToDrop(list, now, 365)).toEqual(["old"]);
  });
});

describe("sameHome", () => {
  const e = (hash: string) => ({ hash, size: 1, type: "application/json" });
  test("ignores chats", () => {
    const a: Manifest = { "scenes/a.json": e("1"), ".odaja/chats/x.json": e("2") };
    const b: Manifest = { "scenes/a.json": e("1") };
    expect(sameHome(a, b)).toBe(true);
  });
  test("sees a changed or removed file", () => {
    expect(sameHome({ "a.json": e("1") }, { "a.json": e("2") })).toBe(false);
    expect(sameHome({ "a.json": e("1"), "b.json": e("1") }, { "a.json": e("1") })).toBe(false);
  });
});
