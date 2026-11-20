import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { newProjectFile, newSceneFile, newShellFile, type StarterRoom } from "../src/model/defaults";
import { formatJson } from "../src/model/format";
import type { CloudAuth } from "./auth";
import type { CloudDb } from "./db/index";
import { projects, type ProjectRow } from "./db/schema";
import type { BlobStore } from "./storage/s3";

export interface CloudAppDeps {
  db: CloudDb;
  blobs: BlobStore;
  auth: CloudAuth;
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

function contentTypeFor(rel: string): string {
  const lower = rel.toLowerCase();
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function projectKey(projectId: string, rel: string): string {
  return `projects/${projectId}/${rel}`;
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

const LOCAL_DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isAllowedOrigin(origin: string, corsOrigins: string[]): boolean {
  if (corsOrigins.includes("*") || corsOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV !== "production" && LOCAL_DEV_ORIGIN.test(origin)) return true;
  return false;
}

export function createCloudApp(deps: CloudAppDeps) {
  const { db, blobs, auth, corsOrigins } = deps;
  const app = new Hono<AppEnv>();

  app.use("*", logger());
  app.use(
    "/api/v1/*",
    cors({
      origin: (origin) => {
        if (!origin) return corsOrigins[0] ?? "*";
        return isAllowedOrigin(origin, corsOrigins) ? origin : "";
      },
      allowHeaders: ["Content-Type", "Authorization", "If-Match"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );

  app.get("/api/v1/health", (c) => c.json({ ok: true, mode: "cloud" }));

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

  const touchProject = async (projectId: string) => {
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
  };

  // --- Projects -------------------------------------------------------------

  app.get("/api/v1/projects", requireAuth, async (c) => {
    const user = c.get("user");
    const rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.ownerId, user.id), isNull(projects.deletedAt)))
      .orderBy(desc(projects.updatedAt));
    return c.json({
      projects: rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt.getTime(),
        updatedAt: r.updatedAt.getTime(),
      })),
    });
  });

  app.post("/api/v1/projects", requireAuth, async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      room?: StarterRoom;
      empty?: boolean;
    };
    const name = String(body.name ?? "Untitled home").trim() || "Untitled home";
    const id = newId();
    const now = new Date();

    await db.insert(projects).values({
      id,
      ownerId: user.id,
      name,
      createdAt: now,
      updatedAt: now,
    });

    if (!body.empty) {
      await Promise.all([
        blobs.put(projectKey(id, "project.json"), formatJson(newProjectFile(name)), {
          contentType: "application/json; charset=utf-8",
        }),
        blobs.put(projectKey(id, "shell.json"), formatJson(newShellFile(body.room)), {
          contentType: "application/json; charset=utf-8",
        }),
        blobs.put(projectKey(id, "scenes/current.json"), formatJson(newSceneFile("Current")), {
          contentType: "application/json; charset=utf-8",
        }),
      ]);
    }

    return c.json({ id, name, createdAt: now.getTime(), updatedAt: now.getTime() }, 201);
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

  // --- Project Files (S3-backed) --------------------------------------------

  app.get("/api/v1/projects/:pid/files", requireAuth, requireProjectAccess("read"), async (c) => {
    const project = c.get("project");
    const sub = c.req.query("prefix");
    const trimmedSub = sub ? sub.replace(/\/+$/, "") : "";
    const cleanSub = trimmedSub ? safeRelPath(trimmedSub) : "";
    if (trimmedSub && !cleanSub) return c.json({ error: "Invalid prefix" }, 400);
    const rootPrefix = `projects/${project.id}/`;
    const listPrefix = cleanSub ? `${rootPrefix}${cleanSub}${sub?.endsWith("/") ? "/" : ""}` : rootPrefix;
    const keys = await blobs.list(listPrefix);
    const files = keys
      .filter((k) => k.startsWith(rootPrefix))
      .map((k) => k.slice(rootPrefix.length));
    return c.json({ files });
  });

  const readFileHandler = async (c: Context<AppEnv>) => {
    const project = c.get("project");
    const rel = safeRelPath(c.req.query("path"));
    if (!rel) return c.json({ error: "Invalid path" }, 400);
    const obj = await blobs.get(projectKey(project.id, rel));
    if (!obj) return c.json({ error: "Not found" }, 404);
    const headers = new Headers();
    headers.set("Content-Type", obj.contentType ?? contentTypeFor(rel));
    headers.set("Cache-Control", "no-store");
    if (obj.etag) headers.set("ETag", obj.etag);
    return new Response(obj.body.slice().buffer, { status: 200, headers });
  };

  app.get("/api/v1/projects/:pid/file", requireAuth, requireProjectAccess("read"), readFileHandler);

  app.put("/api/v1/projects/:pid/file", requireAuth, requireProjectAccess("write"), async (c) => {
    const project = c.get("project");
    const rel = safeRelPath(c.req.query("path"));
    if (!rel) return c.json({ error: "Invalid path" }, 400);
    const body = new Uint8Array(await c.req.arrayBuffer());
    const contentType = c.req.header("Content-Type") || contentTypeFor(rel);
    const res = await blobs.put(projectKey(project.id, rel), body, { contentType });

    // Keep project.name in sync when project.json is saved.
    if (rel === "project.json") {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(body)) as { name?: unknown };
        if (typeof parsed.name === "string" && parsed.name.trim() && parsed.name.trim() !== project.name) {
          await db
            .update(projects)
            .set({ name: parsed.name.trim(), updatedAt: new Date() })
            .where(eq(projects.id, project.id));
          return c.json({ ok: true, etag: res.etag });
        }
      } catch {
        // Ignore malformed JSON; still update timestamp below.
      }
    }
    await touchProject(project.id);
    return c.json({ ok: true, etag: res.etag });
  });

  app.delete("/api/v1/projects/:pid/file", requireAuth, requireProjectAccess("write"), async (c) => {
    const project = c.get("project");
    const rel = safeRelPath(c.req.query("path"));
    if (!rel) return c.json({ error: "Invalid path" }, 400);
    await blobs.del(projectKey(project.id, rel));
    await touchProject(project.id);
    return c.json({ ok: true });
  });

  // Serves binary assets (.glb, textures, plan images).
  // Defaults to streaming through the API with CORS headers (required for
  // S3 servers without CORS like local ferdzo/fs). Set S3_PRESIGN_ASSETS=true
  // on R2/S3 buckets with CORS configured to redirect straight to S3/CDN.
  app.get("/api/v1/projects/:pid/asset", requireAuth, requireProjectAccess("read"), async (c) => {
    const project = c.get("project");
    const rel = safeRelPath(c.req.query("path"));
    if (!rel) return c.json({ error: "Invalid path" }, 400);
    if (process.env.S3_PRESIGN_ASSETS === "true") {
      const signed = await blobs.presignGet(projectKey(project.id, rel), 900);
      return c.redirect(signed, 302);
    }
    const obj = await blobs.get(projectKey(project.id, rel));
    if (!obj) return c.json({ error: "Not found" }, 404);
    const headers = new Headers();
    headers.set("Content-Type", obj.contentType ?? contentTypeFor(rel));
    headers.set("Cache-Control", "private, max-age=300");
    if (obj.etag) headers.set("ETag", obj.etag);
    return new Response(obj.body.slice().buffer, { status: 200, headers });
  });

  return app;
}
