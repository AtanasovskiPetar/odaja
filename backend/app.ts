import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type Anthropic from "@anthropic-ai/sdk";
import { newProjectFile, newSceneFile, newShellFile, type StarterRoom } from "../src/model/defaults";
import { formatJson } from "../src/model/format";
import { beforeAiLabel } from "../src/agent/chat/anthropic";
import { affordableOutput, defaultModel, type AiConfig } from "./ai/config";
import { nextMonthStart, type CreditStatus, type Credits } from "./ai/credits";
import { homeArea } from "./ai/homeFiles";
import type { AiLimits } from "./ai/limits";
import type { Usage } from "./ai/usage";
import { baseTokens, estimateTokens, MIN_STEP_OUTPUT, runHostedTurn, type ImageInput, type Message, type Screenshots, type TurnEvent } from "./ai/turn";
import type { CloudAuth, SignInMethods } from "./auth";
import type { CloudDb } from "./db/index";
import { projects, user as users, type ProjectRow, type VersionReason } from "./db/schema";
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
  // AI on our key (backend/ai/); without it the server offers none.
  ai?: CloudAi;
  // Who sees the admin view (ADMIN_EMAILS): these addresses, confirmed when
  // the server can send email (so nobody signs up as one to get in).
  admins?: { emails: string[]; needVerifiedEmail: boolean };
}

export interface CloudAi {
  cfg: AiConfig;
  credits: Credits;
  limits: AiLimits;
  screenshots: Screenshots;
  client: Anthropic;
  usage: Usage;
}

// Largest AI request: the conversation so far with its photos and screenshots.
const MAX_AI_REQUEST = 40 * 1024 * 1024;

type AppVariables = {
  user: { id: string; email: string; name: string; emailVerified: boolean };
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

// Images sent with an AI request: base64 JPEG, PNG, WebP or GIF; null when
// the list isn't one.
function imagesIn(value: unknown, max: number): ImageInput[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const out: ImageInput[] = [];
  for (const v of value as { mimeType?: unknown; data?: unknown }[]) {
    if (typeof v?.mimeType !== "string" || !/^image\/(jpeg|png|webp|gif)$/.test(v.mimeType) || typeof v.data !== "string") return null;
    out.push({ mimeType: v.mimeType, data: v.data });
  }
  return out;
}

// The earlier conversation, as the app kept it: only its shape is checked.
// Whatever it says, it's the asker's own conversation, and they pay for it.
const isMessage = (m: unknown) => {
  const o = m as { role?: unknown; content?: unknown } | null;
  return Boolean(o) && (o!.role === "user" || o!.role === "assistant") && (typeof o!.content === "string" || Array.isArray(o!.content));
};

const LOCAL_DEV_ORIGIN =/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isAllowedOrigin(origin: string, corsOrigins: string[]): boolean {
  if (corsOrigins.includes("*") || corsOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV !== "production" && LOCAL_DEV_ORIGIN.test(origin)) return true;
  return false;
}

export function createCloudApp(deps: CloudAppDeps) {
  const { db, blobs, auth, signInMethods, homes, events, corsOrigins, ai, admins } = deps;
  const app = new Hono<AppEnv>();

  app.use("*", logger());
  app.use(
    "/api/v1/*",
    cors({
      origin: (origin) => {
        if (!origin) return corsOrigins[0] ?? "*";
        return isAllowedOrigin(origin, corsOrigins) ? origin : "";
      },
      allowHeaders: ["Content-Type", "Authorization", "If-Match", "If-None-Match", "x-captcha-response"],
      exposeHeaders: ["ETag"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );

  app.get("/api/v1/health", (c) => c.json({ ok: true, mode: "cloud" }));
  // What the sign-in window offers (each method is on when configured).
  // And whether it has AI of its own, with which models.
  const aiModels = () => (ai?.cfg.enabled ? ai.cfg.models.map((m) => ({ id: m.id, name: m.name, rate: m.rate, default: m === defaultModel(ai.cfg) })) : []);
  app.get("/api/v1/config", (c) => c.json({ signIn: signInMethods, ai: { enabled: Boolean(ai?.cfg.enabled), models: aiModels() } }));

  // Mount better-auth (signup, signin, signout, get-session).
  app.on(["GET", "POST"], "/api/v1/auth/*", (c) => auth.handler(c.req.raw));

  const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) return c.json({ error: "Unauthorized" }, 401);
    c.set("user", {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      emailVerified: Boolean(session.user.emailVerified),
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
    // The name lives in project.json (the app shows that one); the list's
    // name follows it when it's saved.
    for (let attempt = 0; attempt < 3; attempt++) {
      const [row] = await db.select({ manifest: projects.manifest }).from(projects).where(eq(projects.id, project.id));
      const entry = row?.manifest["project.json"];
      const bytes = entry && (await getContent(blobs, entry));
      if (!entry || !bytes) break;
      let doc: Record<string, unknown>;
      try {
        doc = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        break;
      }
      const res = await homes.save(project.id, "project.json", new TextEncoder().encode(formatJson({ ...doc, name })), entry.hash, c.get("user").id, { name });
      if (res.ok) {
        if (res.changed) events.publish(project.id, { path: "project.json", hash: res.entry!.hash });
        break;
      }
    }
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

  // Every file with its fingerprint: a tab back from a lost connection
  // compares it with what it has, to load what changed meanwhile.
  app.get("/api/v1/projects/:pid/manifest", requireAuth, requireProjectAccess("read"), (c) => {
    const manifest = c.get("project").manifest;
    return c.json({ files: Object.fromEntries(Object.entries(manifest).map(([rel, e]) => [rel, e.hash])) });
  });

  // Content with its fingerprint as the ETag; `If-None-Match` answers 304.
  const serveFile = async (c: Context<AppEnv>, cache: string) => {
    const project = c.get("project");
    const rel = safeRelPath(c.req.query("path"));
    if (!rel) return c.json({ error: "Invalid path" }, 400);
    const entry = project.manifest[rel];
    if (!entry) return c.json({ error: "Not found" }, 404);
    const headers = new Headers({
      ETag: etagOf(entry.hash),
      "Cache-Control": cache,
      "Content-Type": entry.type,
      // A home's files are data, never pages: an SVG (or anything) opened
      // directly can't run scripts on this server's address.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
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

  // --- AI on our key (docs/cloud-plan.md, "AI") -----------------------------

  // May this account use the starter and monthly credits? Only with a
  // confirmed email address, when the server can send one.
  const eligible = (user: AppVariables["user"]) => !ai?.cfg.requireVerifiedEmail || user.emailVerified;
  // Millicredits as credits, with two decimals.
  const credits = (milli: number) => Math.floor(milli / 10) / 100;
  // Where more credits come from: next month (the allowance, or the ceiling
  // starting again when that's what limits), or buying them.
  const moreCredits = (cfg: AiConfig, limitedBy: CreditStatus["limitedBy"]) => ({
    nextAllowance: cfg.monthlyCredits > 0 || limitedBy === "ceiling" ? nextMonthStart(new Date()).getTime() : null,
    topUpUrl: cfg.topUpUrl ?? null,
  });
  // The reply running for each account (one at a time), to stop it.
  const running = new Map<string, AbortController>();

  // The account's credits, and what it can use.
  app.get("/api/v1/ai", requireAuth, async (c) => {
    if (!ai?.cfg.enabled) return c.json({ enabled: false });
    const user = c.get("user");
    const status = await ai.credits.status(user.id, eligible(user));
    return c.json({
      enabled: true,
      balance: credits(status.available),
      needsVerifiedEmail: !eligible(user),
      ...moreCredits(ai.cfg, status.limitedBy),
      ...(isAdmin(user) ? { admin: true } : {}),
    });
  });

  // The Usage page: the balance by kind, this month, every reply with its
  // cost, and what was added. `before` (ms) pages back through older replies.
  app.get("/api/v1/ai/usage", requireAuth, async (c) => {
    if (!ai) return c.json({ error: "This server has no AI of its own" }, 404);
    const user = c.get("user");
    const before = Number(c.req.query("before")) || undefined;
    const [status, usage] = await Promise.all([ai.credits.status(user.id, eligible(user)), ai.usage.forUser(user.id, { before })]);
    return c.json({ balance: { available: status.available / 1000, free: status.free / 1000, bought: status.bought / 1000 }, ...usage });
  });

  // --- Admin (ADMIN_EMAILS): every route checks on its own ---------------

  const isAdmin = (user: AppVariables["user"]) =>
    Boolean(admins?.emails.includes(user.email.toLowerCase()) && (!admins.needVerifiedEmail || user.emailVerified));
  // Not found, rather than forbidden: the routes don't say they exist.
  const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!ai || !isAdmin(c.get("user"))) return c.json({ error: "Not found" }, 404);
    await next();
  };

  app.get("/api/v1/admin/usage", requireAuth, requireAdmin, async (c) => {
    const period = c.req.query("period") === "30-days" ? "30-days" : "month";
    return c.json(await ai!.usage.overview(period));
  });

  app.get("/api/v1/admin/accounts/:id", requireAuth, requireAdmin, async (c) => {
    const account = await ai!.usage.account(c.req.param("id"));
    return account ? c.json(account) : c.json({ error: "No such account" }, 404);
  });

  // Give credits by hand (free ones; a negative amount takes back).
  app.post("/api/v1/admin/grant", requireAuth, requireAdmin, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: unknown; credits?: unknown; note?: unknown } | null;
    const amount = Number(body?.credits);
    if (typeof body?.email !== "string" || !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
      return c.json({ error: "Give an email address and a number of credits." }, 400);
    }
    const [account] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email.trim().toLowerCase()));
    if (!account) return c.json({ error: `No account with the email ${body.email.trim()}.` }, 404);
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : undefined;
    const balance = await ai!.credits.grant(account.id, amount, "grant", { ...(note ? { note } : {}), by: c.get("user").email });
    return c.json({ ok: true, id: account.id, balance: balance / 1000 });
  });

  // Stop the account's running reply: it settles what was used and still
  // sends its last event, so the tab keeps an exact account of it.
  app.post("/api/v1/ai/stop", requireAuth, (c) => {
    running.get(c.get("user").id)?.abort();
    return c.json({ ok: true });
  });

  // A reply from our AI on this home, streamed as Server-Sent Events (one
  // JSON event per `data:` line; backend/ai/turn.ts says which). Refusals
  // before it starts are plain JSON with a `code`.
  const aiBodyLimit = bodyLimit({
    maxSize: MAX_AI_REQUEST,
    onError: (c) => c.json({ error: "This conversation is too big to send. Start a new chat.", code: "too-big" }, 413),
  });
  app.post("/api/v1/projects/:pid/ai/turn", requireAuth, requireProjectAccess("write"), aiBodyLimit, async (c) => {
    if (!ai?.cfg.enabled) return c.json({ error: "This server has no AI of its own", code: "no-ai" }, 404);
    const { cfg } = ai;
    const user = c.get("user");
    const project = c.get("project");
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return c.json({ error: "Invalid request" }, 400);

    // Every photo shared in the chat comes along (the tools name them by
    // their place, photo-1, …); the request's size is what limits them.
    const images = imagesIn(body.images, 6);
    const photos = imagesIn(body.photos, Infinity);
    const text = typeof body.text === "string" ? body.text.slice(0, 20_000) : "";
    const chatId = typeof body.chatId === "string" && /^[a-z0-9-]{1,64}$/.test(body.chatId) ? body.chatId : null;
    const history = Array.isArray(body.messages) ? (body.messages as Message[]) : [];
    const model = cfg.models.find((m) => m.id === body.model) ?? defaultModel(cfg);
    if (!chatId || images === null || photos === null || (!text.trim() && images.length === 0) || !history.every(isMessage)) return c.json({ error: "Invalid request" }, 400);
    if (!eligible(user)) return c.json({ error: "Confirm your email address to use Odaja's AI.", code: "verify-email" }, 403);

    const inputTokens = baseTokens() + estimateTokens([history, text, images.map(() => ({ type: "image" }))]);
    if (inputTokens > cfg.maxHistoryTokens) return c.json({ error: "This conversation has grown long.", code: "history-too-long" }, 409);

    const slot = ai.limits.start(user.id);
    if (!slot.ok) {
      const message =
        slot.reason === "busy" ? "Another reply is still running. Wait for it, or stop it." : slot.reason === "minute" ? "That's a lot of requests in a minute. Wait a moment and try again." : "That's the most replies for today. Try again tomorrow.";
      return c.json({ error: message, code: `limit-${slot.reason}`, retryAfter: slot.retryAfter }, 429, { "Retry-After": String(slot.retryAfter) });
    }
    try {
      const { available, limitedBy } = await ai.credits.status(user.id, true);
      if (affordableOutput(cfg, model, available, inputTokens) < MIN_STEP_OUTPUT) {
        slot.done();
        const ceiling = limitedBy === "ceiling";
        return c.json(
          {
            error: ceiling ? "That's this month's most for Odaja's AI." : "You're out of credits for Odaja's AI.",
            code: ceiling ? "ceiling" : "no-credits",
            balance: credits(available),
            ...moreCredits(cfg, limitedBy),
          },
          402,
        );
      }
      // The home as it is now, so the whole reply can be undone from History.
      await homes.addVersion(project.id, "before-ai", beforeAiLabel(text), user.id);
    } catch (err) {
      slot.done();
      throw err;
    }

    const ui = (body.ui ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.length < 300 ? v : null);
    const area = homeArea({ db, blobs, homes, events }, project.id, user.id);
    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      running.set(user.id, controller);
      stream.onAbort(() => controller.abort());
      // One write at a time, in order.
      let writing = Promise.resolve();
      const emit = (e: TurnEvent) => {
        writing = writing.then(() => stream.writeSSE({ data: JSON.stringify(e) })).catch(() => {});
      };
      // Long model steps can be quiet for a while; keep the connection open.
      const ping = setInterval(() => {
        writing = writing.then(() => stream.writeSSE({ event: "ping", data: "" })).catch(() => {});
      }, 15_000);
      try {
        await runHostedTurn(
          { ...ai, db },
          {
            userId: user.id,
            projectId: project.id,
            model,
            chatId,
            history,
            text,
            images,
            photos,
            ui: { scenePath: str(ui.scenePath), level: str(ui.level), editingObject: str(ui.editingObject) },
            area,
          },
          (e) => {
            if (e.type === "done") e.balance = e.balance === null ? null : credits(e.balance);
            emit(e);
          },
          controller.signal,
        );
      } finally {
        clearInterval(ping);
        if (running.get(user.id) === controller) running.delete(user.id);
        slot.done();
        await writing;
      }
    });
  });

  // The tab's answer to a screenshot the tools asked for.
  app.post("/api/v1/ai/screenshot", requireAuth, async (c) => {
    if (!ai) return c.json({ error: "Not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as { id?: unknown; data?: unknown; mimeType?: unknown; error?: unknown } | null;
    if (!body || typeof body.id !== "string") return c.json({ error: "Invalid request" }, 400);
    const ok = ai.screenshots.answer(c.get("user").id, body.id, {
      data: typeof body.data === "string" ? body.data : undefined,
      mimeType: typeof body.mimeType === "string" && /^image\/(jpeg|png|webp)$/.test(body.mimeType) ? body.mimeType : undefined,
      error: typeof body.error === "string" ? body.error.slice(0, 300) : undefined,
    });
    return ok ? c.json({ ok: true }) : c.json({ error: "No screenshot was asked for" }, 404);
  });

  return app;
}
