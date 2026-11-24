# Odaja Cloud Platform — Progress & Architecture

On `master` since [#10](https://github.com/AtanasovskiPetar/odaja/pull/10) (built on the `feat/cloud-backend` branch). Not deployed: the website is built without `VITE_CLOUD_API_URL`, so it has no cloud.

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
  - rate limits on (Better Auth's, stricter for sign-in and sign-up);
  - Cloudflare Turnstile (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`): making an account, asking for a sign-in link and asking for a password reset need a Turnstile token (Better Auth's `captcha` plugin, header `x-captcha-response`). The sign-in window loads the widget (`src/cloud/turnstile.ts`), invisible unless Cloudflare wants a tick. Password sign-in and Google/GitHub don't ask. For development, Cloudflare's test keys always pass (`.env.example`).
- **Frontend integration (`src/cloud/platform.ts`, `src/cloud/withCloud.ts`, `src/platform.ts`)**:
  - Implements Odaja's existing `Platform` interface (`kind: "cloud"`), leaving local companion (`server/`) and browser OPFS (`src/browser/`) untouched.
  - **The cloud is an account, not another app**: with `VITE_CLOUD_API_URL` set (at build time), `withCloud()` wraps the local host. The app opens as always (no login wall); signing in (the sidebar's account button, or the welcome) adds the account's homes to the same lists, marked `cloud:<id>`. Opening a home picks where its files live; signing out goes back to the local home. New homes can go to the account; "Copy to your account" copies the open local home.
  - **Saving (`src/cloud/platform.ts`)**: the client remembers each file's hash as the server last told it (reads, saves, change events) and sends it with every save. Saves of one file go out one at a time, only the latest content, so quick edits never race each other (25 quick edits: 2 requests). A `412`, or a change event for a file with a save still waiting, means someone else was first: theirs is loaded and the app says so.
  - **Saved / Saving… / Offline / Not saved** (`src/cloud/saveStatus.ts`) next to the home's name. Without a connection, changes wait in the tab and go out when it's back (retrying with backoff, on the browser's `online` event, and when the change stream reconnects); closing the tab then asks first. After a lost connection the tab compares `GET /projects/:pid/manifest` with what it has and loads what changed meanwhile. A refused save (a 4xx other than 408/429) isn't retried; the app says why.
  - **The furniture library is the computer's**: in an account home, the library is still the website's (browser storage) or the companion's folder (`Platform.libraryFiles()`). Placing an item copies its model or texture into the home (`assets/…`), so the home is complete on any computer; the AI tools see the same library. A library kept in the account is for later.
  - **`.odaja` files**: exporting an account home packs its files; opening a file while an account home is open makes a new home in the account (it never replaces the browser's home).
  - History (home menu → History…) lists, names and restores versions; the chat keeps a version before each AI reply.
  - **The website's Content Security Policy** (`scripts/webBuild.ts`): a build with `VITE_CLOUD_API_URL` also allows that server (API, images, models) and Turnstile's script and frame; without it the policy is as before.
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
| `backend/auth.ts` | `better-auth` config: sign-in methods by configuration, Turnstile, rolling 30-day sessions, rate limits, dev localhost `trustedOrigins` |
| `backend/app.ts` | Hono API (`/api/v1/health`, `/config`, `/auth/*`, `GET/POST/PATCH/DELETE /projects`, `GET /files`, `GET /manifest` (every file's hash), `GET/PUT/DELETE /file` with `If-Match`, `GET /asset` (304s, opt-in `S3_PRESIGN_ASSETS=true`), `GET /events`, `GET/POST /versions`, `POST /versions/:vid/restore`) |
| `backend/entries/bun.ts` | `Bun.serve` entrypoint (`:8787`) and the hourly tidying |

### Frontend Cloud & UI System
| File | Purpose |
|---|---|
| `src/platform.ts` | `kind: "cloud"`, `versions` and `cloud` on the interface; the cloud only when `VITE_CLOUD_API_URL` is set |
| `src/cloud/withCloud.ts` | Local homes and the account's homes side by side |
| `src/cloud/auth.ts` | `useCloudAuth` Zustand store with background session refresh |
| `src/cloud/platform.ts` | Cloud `Platform` implementation (projects, scenes, shells, files, chats, `.odaja` zip import/export, sample flat, in-app AI tools): saving one file at a time with `If-Match`, waiting offline, catching up after a lost connection, copying library items in |
| `src/cloud/saveStatus.ts` | The save status shown next to the home's name |
| `src/cloud/turnstile.ts` | Loading and running the Turnstile widget |
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

## 4. Phase 1: done

What phase 1 of [cloud-plan.md](cloud-plan.md) asks for is built and was checked end to end (Postgres and `ferdzo/fs` in Docker, the website and the companion, a production build with its Content Security Policy):

- signing up through Turnstile, password sign-in, signing out back to the local home;
- copying a home to the account, "Saved" next to its name, 25 quick edits saved in order without a false conflict;
- the server stopped: "Offline", edits kept, saved by themselves when it was back;
- another device saving while this tab's save waited: theirs loaded, this tab said so, nothing overwritten;
- History: naming, restoring, editing after a restore;
- library items placed in an account home from the website's and the companion's library, and seen by the AI tools;
- exporting an account home and opening the file as a new account home;
- the website without an account: as before (no status, the browser's library, the "not saved to a file" dot).

---

## 5. Phase 3: Odaja's own AI, credits, the prompt-first start

Built after phase 1 (phase 3 of [cloud-plan.md](cloud-plan.md)); on only when the server has `ANTHROPIC_API_KEY` and `AI_MODELS` (`.env.example`). Without them, nothing changes: people use their own keys in the page.

**How a reply runs**
- The page (`src/agent/chat/runners.ts`, `runOdaja`) sends the message, the conversation so far (kept with the chat in `.odaja/chats/`, `state.odaja`), the chat's photos and what the app shows (scene, level, shape being edited) to `POST /api/v1/projects/:pid/ai/turn`. The server checks access, a confirmed email (when it can send email), the rate limits and the credits, keeps a `before-ai` version, and streams the reply back as Server-Sent Events.
- The server runs the tool loop with the official Anthropic SDK (`backend/ai/turn.ts`): the same system prompt and tools as the page, the prompt cached (system prompt and tools, plus the conversation), `effort` and the refusal fallback per model from configuration, a step cap.
- **The tools run on the server** on the home in storage (`backend/ai/homeFiles.ts`): a file the tools read is written back only if it still has that content (`If-Match`); if the user changed it meanwhile, the tool fails with a message and the model reads it again. Every write is announced on the home's change stream, so open tabs reload it. The furniture library is the computer's, so on the server the tools see none (saving to it says why). Photo edits (`edit-1`, …) are kept per conversation, never shared between accounts.
- **Screenshots and opening scenes** go to the tab that asked, over the reply's stream: the tab reloads the files the reply changed, takes the picture and answers `POST /api/v1/ai/screenshot` (only the asker can answer).
- A long conversation (`AI_MAX_HISTORY_TOKENS`) is refused with `history-too-long`; the page goes on from a written summary of it.
- Stop asks the server (`POST /api/v1/ai/stop`), which ends the reply, settles what it used and still sends its last event (the exact messages and the credits left); the page reads the stream to the end.

**Credits** (`backend/ai/credits.ts`, tables `credit_accounts`, `credit_ledger`, `ai_usage`)
- Kept in thousandths of a credit. Each reply's real cost (tokens × the model's prices) becomes credits at `AI_CREDITS_PER_USD` × the model's `rate`.
- Before each model step, the most it can cost is held (its output limit sized to what the account can afford, input priced at the dearest rate); after it, what it used is charged (never more than was held) and the rest given back, with a line in the ledger. All in one locked transaction per change, so parallel replies can't spend past the balance or the monthly ceiling (`AI_MONTHLY_CEILING_CREDITS`). A step stopped part way is charged what the API reported for its input and the output streamed so far. Holds left by a stopped server go back when it starts.
- `AI_STARTER_CREDITS` once per account (with a confirmed email when email is set up); `AI_MONTHLY_CREDITS` tops the balance up to that each month. `bun run credits:grant <email> <credits> [note]` adds credits by hand.
- Per account: one reply at a time, `AI_REPLIES_PER_MINUTE`, `AI_REPLIES_PER_DAY` (`backend/ai/limits.ts`, in memory like the change events).
- Out of credits (or at the ceiling) the chat says so and offers buying credits (`AI_TOP_UP_URL`, when set), your own key, or when more come.

**In the app**
- "Odaja AI (credits)" in the chat's model picker (`src/agent/chat/models.ts`), ready when signed in, with the credits left (`src/cloud/ai.ts`). On a home that isn't in the account, it offers to copy it there.
- **The prompt-first start** (`src/ui/PromptStart.tsx`): the welcome opens on "Describe your home, or drop in a floor plan…", with examples and floor plans (PDFs become images). Send makes a home in the account and builds it; signed out, the sign-in opens first and the prompt and images are kept through it (also through Google/GitHub's redirect). With a key or model of your own already set up, or without a cloud server, the home is made here and built with it; with neither, the chat opens with the prompt and the key settings. "Use your own API key" and "Start without AI" (the usual form) are under the box.
- **The live build** (`src/ui/chat/BuildProgress.tsx`): a reply on a home without walls shows its steps ("Drawing the walls… Placing furniture") over the view; the first walls are framed, and the view moves into 3D at the end.

**Running it locally**: as in §3, plus `ANTHROPIC_API_KEY` and `AI_MODELS` in `.env` (see `.env.example`), `bun run db:push` for the new tables. Tests: `bun test backend`; with `TEST_DATABASE_URL` and `TEST_S3_ENDPOINT` (compose.yml's Postgres and `ferdzo/fs`) also the credits under parallel spending, the tools on a home in storage, and whole replies with a scripted model.

---

## 6. Next

See the phases in [cloud-plan.md](cloud-plan.md). Next is phase 0 (domain, host, licence, spikes, and the AI-cost measurements that set the model, credit rate and allowances), then phase 2 (deployed: secrets per environment, migrations instead of `db:push`, `LISTEN/NOTIFY`, one cleanup job and shared rate limits and credit holds for more than one server, an upload size limit). Then: sharing (viewer links, Make a copy), usage and admin (phase 4b: the Usage page, the admin view, free and bought credits apart), payments, remote MCP, teams. Real-time editing comes later, when people ask for it.
