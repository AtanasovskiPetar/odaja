// The AI tools on a home in storage, against compose.yml's Postgres and S3:
//   TEST_DATABASE_URL=… TEST_S3_ENDPOINT=http://localhost:2600 bun test backend
// Skipped without both.
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { callTool, type ToolContext } from "../../src/agent/tools";
import { newProjectFile, newSceneFile, newShellFile } from "../../src/model/defaults";
import { formatJson } from "../../src/model/format";
import { createDb } from "../db/index";
import { projects, user } from "../db/schema";
import { createHomeEvents, type HomeChange } from "../events";
import { createHomes, newId } from "../homes";
import { createS3BlobStore } from "../storage/s3";
import { homeArea, homeFiles } from "./homeFiles";

const dbUrl = process.env.TEST_DATABASE_URL;
const s3 = process.env.TEST_S3_ENDPOINT;
const db = dbUrl && s3 ? createDb(dbUrl) : null;
const blobs = s3
  ? createS3BlobStore({ endpoint: s3, publicEndpoint: s3, region: "us-east-1", bucket: "odaja", accessKeyId: "odaja_access_key", secretAccessKey: "odaja_secret_key" })
  : null;
const users: string[] = [];

afterAll(async () => {
  if (db && users.length) await db.delete(user).where(inArray(user.id, users));
});

async function newHome() {
  const homes = createHomes(db!, blobs!);
  await blobs!.ensureBucket();
  const owner = `test-${crypto.randomUUID()}`;
  await db!.insert(user).values({ id: owner, name: "Test", email: `${owner}@example.test` });
  users.push(owner);
  const manifest = await homes.manifestOf({
    "project.json": formatJson(newProjectFile("Test")),
    "shell.json": formatJson(newShellFile({ width: 400, depth: 300, height: 260 })),
    "scenes/current.json": formatJson(newSceneFile("Current")),
  });
  const id = newId();
  await db!.insert(projects).values({ id, ownerId: owner, name: "Test", manifest });
  const events = createHomeEvents();
  const heard: HomeChange[] = [];
  events.subscribe(id, (c) => heard.push(c));
  const area = homeArea({ db: db!, blobs: blobs!, homes, events }, id, owner);
  const ctx: ToolContext = {
    files: () => homeFiles(area),
    scenePath: () => null,
    screenshot: async () => {
      throw new Error("no tab");
    },
    openScene() {},
  };
  return { id, owner, homes, area, ctx, heard };
}

const text = (r: Awaited<ReturnType<typeof callTool>>) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("");

describe.skipIf(!db)("tools on a home in storage", () => {
  test("read the home and change it; open tabs hear of it", async () => {
    const { id, ctx, area, heard } = await newHome();
    const overview = await callTool("get_overview", {}, ctx);
    expect(overview.isError).toBeFalsy();
    expect(text(overview)).toContain("wall-north");

    const added = await callTool("add_object", { name: "Sofa", template: "sofa", position: [200, 150] }, ctx);
    expect(added.isError).toBeFalsy();
    expect([...area.changed.keys()]).toEqual(["scenes/current.json"]);
    expect(new Set(heard.map((h) => h.path))).toEqual(new Set(["scenes/current.json"]));

    // The last change heard is what's stored now.
    const [row] = await db!.select({ manifest: projects.manifest }).from(projects).where(eq(projects.id, id));
    expect(row!.manifest["scenes/current.json"]!.hash).toBe(heard.at(-1)!.hash!);
    expect(area.changed.get("scenes/current.json")).toBe(heard.at(-1)!.hash);
  });

  test("a file changed in the app meanwhile isn't overwritten", async () => {
    const { id, owner, homes, area } = await newHome();
    await area.readText("scenes/current.json");
    // The user saves the scene in the app after the tool read it.
    const [row] = await db!.select({ manifest: projects.manifest }).from(projects).where(eq(projects.id, id));
    const theirs = formatJson({ ...newSceneFile("Current"), name: "Theirs" });
    const saved = await homes.save(id, "scenes/current.json", new TextEncoder().encode(theirs), row!.manifest["scenes/current.json"]!.hash, owner);
    expect(saved.ok).toBe(true);
    await expect(area.write("scenes/current.json", "{}")).rejects.toThrow(/changed in the app/);
    expect(await area.readText("scenes/current.json")).toBe(theirs);
    // Read again, the tool's next write goes through.
    await area.write("scenes/current.json", formatJson(newSceneFile("Mine")));
  });

  test("the library isn't reachable from the server", async () => {
    const { ctx } = await newHome();
    const list = await callTool("list_library", {}, ctx);
    expect(list.isError).toBeFalsy();
    const saved = await callTool("save_to_library", { object_id: "nope", name: "x", category: "Other" }, ctx);
    expect(saved.isError).toBe(true);
  });

  test("paths can't leave the home", async () => {
    const { area } = await newHome();
    await expect(area.write("../other/project.json", "{}")).rejects.toThrow(/invalid path/);
  });
});
