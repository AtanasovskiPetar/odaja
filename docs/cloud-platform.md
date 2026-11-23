# Odaja Cloud Platform — Progress & Architecture

Branch: `feat/cloud-backend` (merged with `master` @ `v0.8.7`)

This document captures what has been built so far for Odaja's cloud platform, how to run it locally, and the next steps. The decisions behind it (and the phases) are in [cloud-plan.md](cloud-plan.md).

---

## 1. Architecture Summary

- **Run-everywhere backend (`backend/`)**: pure Web Standards **Hono** app (`backend/app.ts`) with a thin Bun entrypoint (`backend/entries/bun.ts`). Ready for Docker/K8s, Cloudflare Workers, or AWS Lambda without rewriting routes.
- **Database (`backend/db/`)**: **Drizzle ORM** over **Postgres 19** (`better-auth` tables + `projects`).
- **S3-compatible storage (`backend/storage/s3.ts`)**: single `aws4fetch` client (Web Crypto, zero Node deps) supporting `ferdzo/fs` (`:2600`) locally, and Cloudflare R2 / AWS S3 / MinIO in production.
- **Stored by content (`backend/storage/content.ts`, `backend/homes.ts`)**: each file content is stored once under its SHA-256 (`blobs/<hash>`, JSON and other text gzip-compressed as `blobs/<hash>.gz`) and never changed. A home is a **manifest** in `projects.manifest` (path → hash, size, type). Images and models are stored once however many homes and versions use them.
  - **Saving with `If-Match`**: reads return the hash as the `ETag`; a save sends `If-Match: "<hash it replaces>"` (or `If-None-Match: *` for a new file). The server stores the content, then moves the path in the manifest in one transaction (`SELECT … FOR UPDATE`) that checks the hash. Someone else saved first → `412` with the current hash, and the app loads the newer file and says so.
  - **Versions (`versions` table)**: a version is a saved manifest. Kept automatically before a save when the last one is over 5 minutes old and the home changed, before each AI reply (`before-ai`), before a restore, and when named. Restoring makes the old manifest current (chats in `.odaja/` stay as they are). An hourly job thins old versions (all of the last day, hourly for a week, daily after; named ones stay; `VERSION_KEEP_DAYS` caps it) and deletes content nothing uses (older than a day).
  - **Live reload (`backend/events.ts`)**: `GET /projects/:pid/events` (Server-Sent Events) tells open tabs which files changed; they reload the ones whose content they don't have. In memory: one server process for now.
- **Auth (`backend/auth.ts`, `src/cloud/auth.ts`)**: `better-auth` with `HttpOnly` cookie sessions, rolling 30-day expiry (refreshed every 24h), automatic frontend session refresh on focus/visibility/timer, and clean `401` handling. Sign-in methods, each on when configured (`GET /api/v1/config` says which):
  - email and password, always (a self-hosted server may have nothing else); minimum 8 characters; optional leaked-password check (`AUTH_CHECK_LEAKED_PASSWORDS`);
  - email links and password resets, with Resend (`RESEND_API_KEY`, `EMAIL_FROM`; `backend/email.ts`); in development without it the links are written to the backend's log; email verification when email is set up;
  - Google and GitHub (`GOOGLE_CLIENT_ID`/`SECRET`, `GITHUB_CLIENT_ID`/`SECRET`);
  - rate limits on (Better Auth's, stricter for sign-in and sign-up). Turnstile is still to do.
- **Frontend integration (`src/cloud/platform.ts`, `src/cloud/withCloud.ts`, `src/platform.ts`)**:
  - Implements Odaja's existing `Platform` interface (`kind: "cloud"`), leaving local companion (`server/`) and browser OPFS (`src/browser/`) untouched.
  - **The cloud is an account, not another app**: with `VITE_CLOUD_API_URL` set (at build time), `withCloud()` wraps the local host. The app opens as always (no login wall); signing in (the sidebar's account button, or the welcome) adds the account's homes to the same lists, marked `cloud:<id>`. Opening a home picks where its files live; signing out goes back to the local home. New homes can go to the account; "Copy to your account" copies the open local home.
  - The client remembers each file's hash, sends it with every save, and reloads on `412` or on a change event. History (home menu → History…) lists, names and restores versions; the chat keeps a version before each AI reply.
---

## 2. Files Added / Changed So Far

### Backend & Infra
| File | Purpose |
|---|---|
| `compose.yml` | Local Postgres 19 (`postgres:19-alpine`) + `ferdzo/fs` (`ghcr.io/ferdzo/fs:latest` on `:2600`) |
| `.env.example` / `.env` | Shared config for Compose, Drizzle, and Hono (`.env` is gitignored) |
| `drizzle.config.ts` | Drizzle Kit Postgres config pointing at `backend/db/schema.ts` |
| `backend/db/schema.ts` | `user`, `session`, `account`, `verification` + `projects` (`id`, `owner_id`, `name`, `manifest`, timestamps) + `versions` |
| `backend/db/index.ts` | Postgres.js + Drizzle client factory |
| `backend/storage/s3.ts` | Single S3 `BlobStore` (`get`, `put`, `del`, `has`, `list`, `listDetailed`, `presignGet`, `ensureBucket`) |
| `backend/storage/content.ts` | Storing by content: SHA-256, gzip for text, ETags |
| `backend/homes.ts` | Saving with `If-Match`, versions, restore, thinning, cleaning up unused content (tests in `homes.test.ts`) |
| `backend/events.ts` | Change events for open tabs |
| `backend/email.ts` | Resend, or the log without it |
| `backend/auth.ts` | `better-auth` config: sign-in methods by configuration, rolling 30-day sessions, rate limits, dev localhost `trustedOrigins` |
| `backend/app.ts` | Hono API (`/api/v1/health`, `/config`, `/auth/*`, `GET/POST/PATCH/DELETE /projects`, `GET /files`, `GET/PUT/DELETE /file` with `If-Match`, `GET /asset` (304s, opt-in `S3_PRESIGN_ASSETS=true`), `GET /events`, `GET/POST /versions`, `POST /versions/:vid/restore`) |
| `backend/entries/bun.ts` | `Bun.serve` entrypoint (`:8787`) and the hourly tidying |

### Frontend Cloud & UI System
| File | Purpose |
|---|---|
| `src/platform.ts` | `kind: "cloud"`, `versions` and `cloud` on the interface; the cloud only when `VITE_CLOUD_API_URL` is set |
| `src/cloud/withCloud.ts` | Local homes and the account's homes side by side |
| `src/cloud/auth.ts` | `useCloudAuth` Zustand store with background session refresh |
| `src/cloud/platform.ts` | Cloud `Platform` implementation (projects, scenes, shells, files, chats, `.odaja` zip import/export, sample flat, in-app AI tools) |
| `src/ui/theme.css` | Tailwind CSS v4 entry + `@layer legacy` isolation + Odaja `@theme` tokens |
| `src/ui/primitives/Button.tsx` | Reusable `default` / `primary` / `ghost` / `danger` button |
| `src/ui/primitives/Input.tsx` | Labeled `TextField` with password Show/Hide toggle |
| `src/ui/primitives/Popover.tsx` | Portal-based floating popover clamped inside the viewport |
| `src/ui/cloud/AuthGate.tsx` | `SignInWindow` (sign in, create account, email link, Google/GitHub, forgotten and new password) + `CloudAccountFooter` (sign-in button, or the user menu) |
| `src/ui/cloud/HistoryDialog.tsx` | A cloud home's versions: name, restore |
| `src/ui/App.tsx` | Reorganized sidebar: Odaja logo header → full-width Home bar → content → pinned bottom Cloud user footer |

---

## 3. Running Locally

```bash
# 1. Start Postgres 19 + ferdzo/fs (:2600)
docker compose up -d

# 2. Push database schema (again after pulling schema changes)
bun run db:push

# 3. Start Hono backend (:8787)
bun run backend:dev

# 4. Start Vite frontend (:5173), with VITE_CLOUD_API_URL from .env (copy .env.example)
bun run dev
```

- The app opens as usual (your folders, or `?host=browser` for the website's browser storage); the sidebar's account button signs in.
- Without email set up, sign-in links and password resets appear in the backend's log.
- `bun test backend` runs the backend's unit tests.

---

## 4. Next Up — Better Projects & Scenes Management

### Projects Dashboard (`All Homes` view)
- Full Tailwind v4 modal/screen reachable from the sidebar **Home** bar (`All homes…`):
  - Search & sort projects (recently updated, name).
  - Project cards/rows with **Open**, inline **Rename**, **Duplicate**, **Export `.odaja`**, and **Delete** (with confirmation).
  - Top-level **+ New home** and **Import `.odaja`** buttons.

### Scenes Panel Refresh
- Migrate `ScenesSection` to Tailwind v4 + portal `Popover`:
  - Clean scene rows with active indicator, custom-walls badge (when using `shells/*.json`), and a `···` portal menu for **Rename**, **Duplicate (same walls)**, **Duplicate (own walls)**, and **Delete** — eliminating clipped inline buttons.

---

## 5. Next

See the phases in [cloud-plan.md](cloud-plan.md). Still open for phase 1: Turnstile on sign-up, the Saved / Saving / Offline status, the cloud furniture library, and Postgres `LISTEN/NOTIFY` for change events once there's more than one server. Then: tools on the server for cloud homes (`ctx.files()` over the content store), the AI proxy with credits, sharing (viewer links, Make a copy), payments, remote MCP, teams. Real-time editing comes later, when people ask for it.
