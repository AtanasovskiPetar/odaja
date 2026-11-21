# Odaja Cloud Platform — Progress & Architecture

Branch: `feat/cloud-backend` (merged with `master` @ `v0.8.7`)

This document captures what has been built so far for Odaja's cloud platform, how to run it locally, and the next steps for Projects/Scenes UX and Phases 2–4.

---

## 1. Architecture Summary

- **Run-everywhere backend (`backend/`)**: pure Web Standards **Hono** app (`backend/app.ts`) with a thin Bun entrypoint (`backend/entries/bun.ts`). Ready for Docker/K8s, Cloudflare Workers, or AWS Lambda without rewriting routes.
- **Database (`backend/db/`)**: **Drizzle ORM** over **Postgres 19** (`better-auth` tables + `projects`).
- **S3-compatible storage (`backend/storage/s3.ts`)**: single `aws4fetch` client (Web Crypto, zero Node deps) supporting `ferdzo/fs` (`:2600`) locally, and Cloudflare R2 / AWS S3 / MinIO in production.
  - Stable S3 key layout: `projects/<projectId>/<relativePath>` — moving a project into a team later requires zero S3 object moves or renames.
- **Auth (`backend/auth.ts`, `src/cloud/auth.ts`)**: `better-auth` email/password with `HttpOnly` cookie sessions, rolling 30-day expiry (refreshed every 24h), automatic frontend session refresh on focus/visibility/timer, and clean `401` handling.
- **Frontend integration (`src/cloud/platform.ts`, `src/platform.ts`)**:
  - Implements Odaja's existing `Platform` interface (`kind: "cloud"`), leaving local companion (`server/`) and browser OPFS (`src/browser/`) untouched.
  - Auto-selects Cloud mode when `VITE_CLOUD_API_URL` is set or `http://localhost:8787/api/v1/health` responds (`?host=server` or `?host=browser` switches back anytime).
- **New UI System (`src/ui/theme.css`, `src/ui/primitives/`)**:
  - **Tailwind CSS v4** (`@tailwindcss/vite`) with Odaja's warm drafting-table design tokens mapped into `@theme`.
  - Legacy `styles.css` isolated in `@layer legacy` so Tailwind utilities always win cleanly during incremental migration.
  - Lightweight primitives: `Button`, `TextField`, and a React Portal `Popover` with viewport clamping (`top`/`bottom` placement) so menus never clip.

---

## 2. Files Added / Changed So Far

### Backend & Infra
| File | Purpose |
|---|---|
| `compose.yml` | Local Postgres 19 (`postgres:19-alpine`) + `ferdzo/fs` (`ghcr.io/ferdzo/fs:latest` on `:2600`) |
| `.env.example` / `.env` | Shared config for Compose, Drizzle, and Hono (`.env` is gitignored) |
| `drizzle.config.ts` | Drizzle Kit Postgres config pointing at `backend/db/schema.ts` |
| `backend/db/schema.ts` | `user`, `session`, `account`, `verification` + `projects` (`id`, `owner_id`, `name`, timestamps) |
| `backend/db/index.ts` | Postgres.js + Drizzle client factory |
| `backend/storage/s3.ts` | Single S3 `BlobStore` (`get`, `put`, `del`, `list`, `presignGet`, `ensureBucket`) |
| `backend/auth.ts` | `better-auth` config with rolling 30-day sessions & dev localhost `trustedOrigins` |
| `backend/app.ts` | Hono API (`/api/v1/health`, `/auth/*`, `GET/POST/PATCH/DELETE /projects`, `GET /files`, `GET/PUT/DELETE /file`, `GET /asset` with CORS streaming + opt-in `S3_PRESIGN_ASSETS=true`) |
| `backend/entries/bun.ts` | `Bun.serve` entrypoint (`:8787`) |

### Frontend Cloud & UI System
| File | Purpose |
|---|---|
| `src/platform.ts` | Added `kind: "cloud"` and automatic cloud detection |
| `src/cloud/auth.ts` | `useCloudAuth` Zustand store with background session refresh |
| `src/cloud/platform.ts` | Cloud `Platform` implementation (projects, scenes, shells, files, chats, `.odaja` zip import/export, sample flat, in-app AI tools) |
| `src/ui/theme.css` | Tailwind CSS v4 entry + `@layer legacy` isolation + Odaja `@theme` tokens |
| `src/ui/primitives/Button.tsx` | Reusable `default` / `primary` / `ghost` / `danger` button |
| `src/ui/primitives/Input.tsx` | Labeled `TextField` with password Show/Hide toggle |
| `src/ui/primitives/Popover.tsx` | Portal-based floating popover clamped inside the viewport |
| `src/ui/cloud/AuthGate.tsx` | `CloudAuthScreen` (Sign in / Create account) + `CloudAccountFooter` (bottom sidebar user menu) |
| `src/ui/App.tsx` | Reorganized sidebar: Odaja logo header → full-width Home bar → content → pinned bottom Cloud user footer |

---

## 3. Running Locally

```bash
# 1. Start Postgres 19 + ferdzo/fs (:2600)
docker compose up -d

# 2. Push database schema
bun run db:push

# 3. Start Hono backend (:8787)
bun run backend:dev

# 4. Start Vite frontend (:5173)
bun run dev
```

- Cloud mode opens by default at `http://localhost:5173/` whenever `:8787` is running.
- Switch modes anytime via `?host=server` (local companion) or `?host=browser` (browser OPFS).

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

## 5. Platform Roadmap (Phases 2–4)

- **Phase 2 — Sharing, Cloud Library & Live Sync**:
  - Public read-only share links (`/p/:slug`) with View / Walk / Present + "Duplicate to my projects".
  - Cloud furniture & material library (`library/<itemId>/...` in S3/R2 + CDN).
  - `If-Match` / `ETag` optimistic locking + `RealtimeBus` SSE live reload across tabs.
- **Phase 3 — Teams & Roles**:
  - `teams`, `team_members` (`owner | editor | viewer`), `team_invites`, nullable `projects.team_id` (zero S3 moves).
- **Phase 4 — Managed AI Proxy & Remote MCP**:
  - `cloudAgentFiles` over `BlobStore`, `/api/v1/ai/chat` with usage ledger + optional BYOK, and `/mcp` Streamable HTTP endpoint with scoped API tokens.
