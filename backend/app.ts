import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import { newProjectFile, newSceneFile, newShellFile, type StarterRoom } from "../src/model/defaults";
import { formatJson } from "../src/model/format";
import type { CloudAuth, SignInMethods } from "./auth";
import type { CloudDb } from "./db/index";
import { projects, type ProjectRow, type VersionReason } from "./db/schema";
import type { HomeEvents } from "./events";
import { newId, type Expected, type Homes } from "./homes";
import { blobKey, etagOf, getContent, parseEtag } from "./storage/content";
import type { BlobStore } from "./storage/s3";

export interface CloudAppDeps {
  db: CloudDb;
  blobs: BlobStore;
  auth: CloudAuth;
  signInMethods: SignInMethods;
  homes: Homes;
  events: HomeEvents;
  corsOrigins: string[];
}

type AppVariables = {
  user: { id: string; email: string; name: string };
  project: ProjectRow;
};

type AppEnv = { Variables: AppVariables };

function safeRelPath(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\\") || cleaned.includes("\0")) return null;
  const parts = cleaned.split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) return null;
  return cleaned;
}

const LOCAL_DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isAllowedOrigin(origin: string, corsOrigins: string[]): boolean {
  if (corsOrigins.includes("*") || corsOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV !== "production" && LOCAL_DEV_ORIGIN.test(origin)) return true;
  return false;
}

export function createCloudApp(deps: CloudAppDeps) {
  const { db, blobs, auth, signInMethods, homes, events, corsOrigins } = deps;
  const app = new Hono<AppEnv>();

  app.use("*", logger());
  app.use(
    "/api/v1/*",
    cors({
      origin: (origin) => {
        if (!origin) return corsOrigins[0] ?? "*";
        return isAllowedOrigin(origin, corsOrigins) ? origin : "";
      },
      allowHeaders: ["Content-Type", "Authorization", "If-Match", "If-None-Match"],
      exposeHeaders: ["ETag"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );

  app.get("/api/v1/health", (c) => c.json({ ok: true, mode: "cloud" }));
  // What the sign-in window offers (each method is on when configured).
  app.get("/api/v1/config", (c) => c.json({ signIn: signInMethods }));

  // Mount better-auth (signup, signin, signout, get-session).
  app.on(["GET", "POST"], "/api/v1/auth/*", (c) => auth.handler(c.req.raw));

  const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) return c.json({ error: "Unauthorized" }, 401);
    c.set("user", {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    });
    await next();
  };

  // Single authorization gate for all project routes.
  // Phase 1 checks ownership; Phase 2/3 will also check share links and teams here.
  const requireProjectAccess = (_perm: "read" | "write" | "delete"): MiddlewareHandler<AppEnv> => {
    return async (c, next) => {
      const pid = c.req.param("pid");
      if (!pid) return c.json({ error: "Missing project id" }, 400);
      const user = c.get("user");
      const [project] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, pid), isNull(projects.deletedAt)))
        .limit(1);
      if (!project) return c.json({ error: "Project not found" }, 404);
      if (project.ownerId !== user.id) return c.json({ error: "Forbidden" }, 403);
      c.set("project", project);
      await next();
    };
  };

  // --- Projects -------------------------------------------------------------

  const summary = (r: Pick<ProjectRow, "id" | "name" | "createdAt" | "updatedAt">) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  });

  app.get("/api/v1/projects", requireAuth, async (c) => {
    const user = c.get("user");
    const rows = await db
      .select({ id: projects.id, name: projects.name, createdAt: projects.createdAt, updatedAt: projects.updatedAt })
      .from(projects)
      .where(and(eq(projects.ownerId, user.id), isNull(projects.deletedAt)))
      .orderBy(desc(projects.updatedAt));
    return c.json({ projects: rows.map(summary) });
  });

  app.post("/api/v1/projects", requireAuth, async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      room?: StarterRoom;
      empty?: boolean;
    };
    const name = String(body.name ?? "Untitled home").trim() || "Untitled home";
    const manifest = body.empty
      ? {}
      : await homes.manifestOf({
          "project.json": formatJson(newProjectFile(name)),
          "shell.json": formatJson(newShellFile(body.room)),
          "scenes/current.json": formatJson(newSceneFile("Current")),
        });
    const [row] = await db.insert(projects).values({ id: newId(), ownerId: user.id, name, manifest }).returning();
    return c.json(summary(row!), 201);
  });

  app.patch("/api/v1/projects/:pid", requireAuth, requireProjectAccess("write"), async (c) => {
    const project = c.get("project");
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    const name = String(body.name ?? "").trim();
    if (!name) return c.json({ error: "Name is required" }, 400);
    const now = new Date();
    await db.update(projects).set({ name, updatedAt: now }).where(eq(projects.id, project.id));
    return c.json({ id: project.id, name, updatedAt: now.getTime() });
  });

  app.delete("/api/v1/projects/:pid", requireAuth, requireProjectAccess("delete"), async (c) => {
    const project = c.get("project");
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, project.id));
    return c.json({ ok: true });
  });

  // --- Files: stored by content, listed by the home's manifest ---------------

  app.get("/api/v1/projects/:pid/files", requireAuth, requireProjectAccess("read"), async (c) => {
    const project = c.get("project");
    const prefix = c.req.query("prefix") ?? "";
    if (prefix && !safeRelPath(prefix.replace(/\/+$/, ""))) return c.json({ error: "Invalid prefix" }, 400);
    return c.json({ files: Object.keys(project.manifest).filter((rel) => rel.startsWith(prefix)) });
  });

  // Content with its fingerprint as the ETag; `If-None-Match` answers 304.
  const serveFile = async (c: Context<AppEnv>, cache: string) => {
    const project = c.get("project");
    const rel = safeRelPath(c.req.query("path"));
    if (!rel) return c.json({ error: "Invalid path" }, 400);
    const entry = project.manifest[rel];
    if (!entry) return c.json({ error: "Not found" }, 404);
    const headers = new Headers({ ETag: etagOf(entry.hash), "Cache-Control": cache, "Content-Type": entry.type });
    if (parseEtag(c.req.header("If-None-Match")) === entry.hash) return new Response(null, { status: 304, headers });
    const body = await getContent(blobs, entry);
    if (!body) return c.json({ error: "Content missing" }, 500);
    return new Response(body as BodyInit, { status: 200, headers });
  };

  app.get("/api/v1/projects/:pid/file", requireAuth, requireProjectAccess("read"), (c) => serveFile(c, "no-store"));

  // `If-Match: "<hash>"`: save only if the file still has that content (412
  // otherwise, with the current hash). `If-None-Match: *`: only if it's new.
  const expectedOf = (c: Context<AppEnv>): Expected => {
    if (c.req.header("If-None-Match")?.trim() === "*") return null;
    return parseEtag(c.req.header("If-Match"));
  };

  const conflict = (c: Context<AppEnv>, current: string | null) =>
    c.json({ error: "This file was changed somewhere else", current }, 412, current ? { ETag: etagOf(current) } : undefined);

  app.put("/api/v1/projects/:pid/file", requireAuth, requireProjectAccess("write"), async (c) => {
    const project = c.get("project");
    const user = c.get("user");
    const rel = safeRelPath(c.req.query("path"));
    if (!rel) return c.json({ error: "Invalid path" }, 400);
    const body = new Uint8Array(await c.req.arrayBuffer());

    // Keep the home's name in step with project.json.
    let name: string | undefined;
    if (rel === "project.json") {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(body)) as { name?: unknown };
        if (typeof parsed.name === "string" && parsed.name.trim()) name = parsed.name.trim();
      } catch {
        // Not JSON: saved as it is.
      }
    }
    const res = await homes.save(project.id, rel, body, expectedOf(c), user.id, { name });
    if (!res.ok) return conflict(c, res.current);
    if (res.changed) events.publish(project.id, { path: rel, hash: res.entry!.hash });
    return c.json({ ok: true, hash: res.entry!.hash }, 200, { ETag: etagOf(res.entry!.hash) });
  });

  app.delete("/api/v1/projects/:pid/file", requireAuth, requireProjectAccess("write"), async (c) => {
    const project = c.get("project");
    const user = c.get("user");
    const rel = safeRelPath(c.req.query("path"));
    if (!rel) return c.json({ error: "Invalid path" }, 400);
    const res = await homes.save(project.id, rel, null, expectedOf(c), user.id);
    if (!res.ok) return conflict(c, res.current);
    if (res.changed) events.publish(project.id, { path: rel, hash: null });
    return c.json({ ok: true });
  });

  // Binary assets (.glb, textures, plan images): revalidated by ETag. With
  // S3_PRESIGN_ASSETS=true (R2/S3 with CORS set up) they redirect to storage.
  app.get("/api/v1/projects/:pid/asset", requireAuth, requireProjectAccess("read"), async (c) => {
    const entry = c.get("project").manifest[safeRelPath(c.req.query("path")) ?? ""];
    if (entry && !entry.gz && process.env.S3_PRESIGN_ASSETS === "true") {
      return c.redirect(await blobs.presignGet(blobKey(entry), 900), 302);
    }
    return serveFile(c, "private, no-cache");
  });

  // Changes to the home, for open tabs to reload (Server-Sent Events).
  app.get("/api/v1/projects/:pid/events", requireAuth, requireProjectAccess("read"), (c) => {
    const project = c.get("project");
    return streamSSE(c, async (stream) => {
      const unsubscribe = events.subscribe(project.id, (change) => {
        void stream.writeSSE({ event: "file-changed", data: JSON.stringify(change) });
      });
      stream.onAbort(unsubscribe);
      while (!stream.aborted) {
        await stream.writeSSE({ event: "ping", data: "" });
        await stream.sleep(20_000);
      }
      unsubscribe();
    });
  });

  // --- Versions --------------------------------------------------------------

  app.get("/api/v1/projects/:pid/versions", requireAuth, requireProjectAccess("read"), async (c) => {
    const list = await homes.listVersions(c.get("project").id);
    return c.json({ versions: list.map((v) => ({ ...v, createdAt: v.createdAt.getTime() })) });
  });

  // Keep the home as it is now: a named version, or the one before an AI reply.
  app.post("/api/v1/projects/:pid/versions", requireAuth, requireProjectAccess("write"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string; label?: string };
    const reason: VersionReason = body.reason === "before-ai" ? "before-ai" : "named";
    const label = String(body.label ?? "").trim().slice(0, 120) || null;
    if (reason === "named" && !label) return c.json({ error: "A name is required" }, 400);
    const v = await homes.addVersion(c.get("project").id, reason, label, c.get("user").id);
    return c.json({ ...v, createdAt: v.createdAt.getTime() }, 201);
  });

  app.post("/api/v1/projects/:pid/versions/:vid/restore", requireAuth, requireProjectAccess("write"), async (c) => {
    const project = c.get("project");
    const changed = await homes.restore(project.id, c.req.param("vid"), c.get("user").id);
    if (!changed) return c.json({ error: "Version not found" }, 404);
    const [row] = await db.select({ manifest: projects.manifest }).from(projects).where(eq(projects.id, project.id));
    for (const path of changed) events.publish(project.id, { path, hash: row?.manifest[path]?.hash ?? null });
    return c.json({ ok: true, changed });
  });

  return app;
}
