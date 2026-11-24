# Odaja in the cloud: plan

Odaja becomes a real product: accounts, homes saved to your account, AI that
works without a key, sharing, teams and paid plans. It stays open source, the
website stays free with your own API key, and the local companion keeps
working without an account. Editing together in real time comes later, once
people ask for it.

This builds on the local-first website in [web-plan.md](web-plan.md).

**Where we are:** phase 1 (accounts and cloud homes for one person) is built and
on `master` ([#10](https://github.com/AtanasovskiPetar/odaja/pull/10); how it
works and how to run it: [cloud-platform.md](cloud-platform.md)). Nothing is
deployed: the website is built without a cloud server, so it behaves as before.
**Next is phase 0** (domain, host, licence, the payment and AI-cost spikes),
because deploying (phase 2) depends on those choices.

## What we agreed

**The product**
- **Open source, always:** the whole repo, including the cloud server. See "Open source rules" below for what that means for how it's built.
- **Licence:** from MIT to **AGPL**, so someone running Odaja as a competing service must publish their changes; anyone can still self-host for themselves. Releases already published stay MIT. **Other people have contributed code**, so each of them must agree to the change (or their parts are rewritten) before it happens. The name and logo stay ours (a trademark), so forks can't present themselves as Odaja.
- **Free with your own key:** every design feature, plus AI on your own API key or a local model. Keys stay in the browser and go straight to their provider, never through our server.
- **Paid for what costs us money:** AI on our key, cloud storage beyond a few homes, sharing features, teams.
- **No login wall:** you can open the app, try the sample and design without an account. Sign-in is asked for when you send a prompt to our AI or save to the cloud.
- **The cloud is an account, not another app:** signing in adds your cloud homes to the home list, next to the homes in the browser (website) or in folders (companion). Signing out leaves everything else as it was.

**Signing in**
- **Three ways, each switched on by configuration:** email and password; an email link; Google and GitHub.
- **Passwords stay** because a self-hosted server may have no email service and no Google or GitHub apps set up; a password is the one way that always works.
- **With email set up** (the hosted site): verify the address, reset a forgotten password, sign in with a link. Without email, links and resets are written to the server's log, for development and small self-hosted servers.
- **Protection:** rate limits on sign-in and sign-up, Turnstile on sign-up, a minimum password length, and a check against known-leaked passwords on the hosted site.

**The first screen: prompt first**
- The website opens on a prompt box: "Describe your home, or drop in a floor plan…", with image upload and example prompts.
- Pressing Send without an account opens the sign-in. The prompt and images are kept through sign-in, and the AI starts straight away.
- The home is built live in front of you: walls, rooms, furniture, the camera moving into 3D. Progress is shown as steps ("Drawing the walls… placing furniture"), not a spinner.
- Under the box: **Use your own API key** (no login) and **Start without AI** (straight into the editor).

**AI**
- **Your own key:** as today, browser to provider directly. Free, no login needed.
- **Free starter allowance:** each verified account gets a small amount of AI on our key, as **credits** (not a prompt count; a big request costs more), on a model chosen for good first results. Steps per reply are capped.
- **Credits:** each reply costs what it really cost us, converted to credits. Pro includes a monthly allowance; top-ups can be bought; there's a hard ceiling per user so no plan can lose money. When credits run out: buy a top-up, add your own key, or wait for next month.
- **Cost control:** a cheap capable default model, prompt caching of the system prompt and tools, trimmed history, screenshots only when asked for. Top models are offered at a higher credit rate.
- **Tools run on the server for cloud homes**, the way the companion runs them on folders today: the same tool code, with `ctx.files()` reading and writing the home in storage. So the in-app chat, our AI and remote MCP all change a cloud home the same way, a tab doesn't have to be open (except for screenshots), and our AI's tools and credits are checked in one trusted place. An open tab reloads what the tools changed.
- **Screenshots** need something that draws the home: an open tab is asked, as in the companion; without one, the tool says to open the home. A headless renderer can come later.
- **Claude Code on your subscription** stays a companion-only option. Our server never uses anyone's subscription.

**Homes in your account**
- **Autosave, no Save button:** every change is kept. The home's name shows "Saved", "Saving…" or "Offline, will save when back".
- **Stored by content:** each file's content is kept once under its fingerprint (SHA-256) and never changed; a home is a list of which content each path has. Only changed files are stored again, and images and models are stored once however many versions use them. JSON is compressed (a 210 KB scene is about 22 KB).
- **Version history:** a version is a saved list of paths and contents, so it costs only the files that changed. Versions are recorded automatically every few minutes of editing, **before each AI reply** ("Before: Furnish the living room"), before a restore, plus named versions ("Option A"). A History panel to look at and restore any of them. Old versions are thinned (all of the last day, hourly for a week, daily after that); how far back is kept depends on the plan. Content no version uses any more is cleaned up.
- **One person editing, with a safety check:** every save says which content it replaces (`If-Match` with the file's fingerprint). If another tab, device or AI turn saved first, the save is refused, nothing is lost, and the app reloads the newer file and says so. Open tabs are told about changes and reload them.
- **`.odaja` files stay** for export, backup and moving homes between the website, the companion and other accounts.
- **Visitors without an account** keep working in browser storage, as today. After signing in: "Copy to your account" (the browser's copy stays until they delete it, so nothing is lost if something goes wrong).

**Sharing**
- **What:** a whole home, or **one scene** (one layout option).
- **With whom:** people by email (an invite if they have no account yet), or **anyone with the link**, with no login needed to view. Links can have an expiry date and a password, and can be turned off.
- **First, viewing:** a viewer can look around in plan, 3D and Walk, try sunlight and lamps (nothing saved), and, if allowed, **Make a copy** into their own account.
- **Then, editing someone else's home:** one person at a time per file, with the same `If-Match` check as above; whoever saves second reloads. Real-time editing replaces this later.
- **A scene share** gets only what the scene needs: its shell, materials, library items and assets. Never the other scenes. **Walls are read-only for scene editors**, because a wall belongs to every scene of the home; editing walls needs the whole home.
- **AI chats are private per person**, whatever is shared.
- **AI in a shared home:** whoever writes the prompt pays, with their own credits or key.
- Comments (pinned to objects, walls or a spot) come later.

**Teams**
- **Workspaces:** every user has a personal workspace; a team is a separate workspace. A switcher at the top of the home list.
- **Team homes belong to the team**, not to whoever made them, and stay when someone leaves. Homes can move between personal and team workspaces.
- **Every member sees every team home** by default. **Folders** (per client) organise them; **restricted folders or homes** are visible only to chosen members (admins always see everything); a member can keep a **private draft** until it's ready.
- **Sharing is for people outside the team.** An outside editor joins as a **guest**.
- **Roles:** owner, admin, editor, viewer. **Only editors pay** (a seat); viewers and commenters are free, so teams invite clients freely.
- **Billing per editor seat**, no fixed limit, with a minimum of 2 seats, prorated when seats change.
- **AI credits are pooled:** each seat adds a monthly allowance to the team's pot; admins can set limits per member and buy top-ups. Members can still use their own key.
- **The team library:** furniture, materials and saved objects shared by every member.
- Team management and billing live on the website only.

**Later: editing together in real time**
- Not part of the first versions. Nothing above stands in its way: homes are already files with versions, and saving whole files can later give way to live changes.
- When it comes: **server-authoritative sync** in the style of Figma and tldraw, not a CRDT. One coordinator per home orders and validates changes; clients apply their own changes at once; last write wins per property; the server can refuse invalid geometry and changes the person isn't allowed to make.
- **Presence** (cursors and selections on the plan, avatars, a figure where each person stands in Walk), **undo of only your own changes**, short disconnects queued and resent.
- What it needs first: stable ids for every record list that lacks them (walls, openings, objects…), record patches diffed from today's operations, and validation in the server. See "Real-time editing (later)" below.

**Plans** (what each includes; prices are set in the billing provider, not in this repo)

| | Free | Pro | Team |
|---|---|---|---|
| Design features, `.odaja` files, companion | ✓ | ✓ | ✓ |
| AI on your own key or a local model | ✓ | ✓ | ✓ |
| AI on our key | starter allowance | monthly credits + top-ups | pooled credits per seat |
| Cloud homes | a few | unlimited | unlimited, owned by the team |
| Version history | short | long | long |
| Share as viewer, Make a copy | ✓ | ✓ | ✓ |
| Others editing your homes | – | ✓ | ✓ |
| Link passwords and expiry | – | ✓ | ✓ |
| Folders, restricted access, team library | – | – | ✓ |

Team billing is per editor seat, with a minimum number of seats. An early-supporter offer runs before or during the build, to turn "I'd pay for this" into payments and a first group of users.

**Local: the companion (`odaja`)**
- **The same app and screens** as the website, at `localhost:5180`, including the prompt-first start and History.
- **No account needed.** Signed out, homes are folders, as today.
- **The model picker:** Claude Code (your subscription, the default when installed and signed in; nothing counted), your API keys, local models, and our credits when signed in.
- **Local homes** (folders): every change written to disk straight away, **local version history** in the home's `.odaja/versions/` (stored by content, same History panel), editing files directly still shows up live, MCP as today (`claude mcp add odaja -- ~/.local/bin/odaja mcp`). Single-user and private: no sharing.
- **Signed in:** the workspace switcher; personal and team cloud homes; the team library next to the local one; Share on cloud homes; "Move to my account / team" for a local home and "Download as a folder" for a cloud one.
- **Cloud homes in the companion** are read and written on the cloud server, as on the website; there is **no local mirror and no sync engine**. Claude Code's and MCP's tool calls on a cloud home go to the cloud server's tools, as the signed-in user with the same permissions.
- **The homes folder:** `~/Documents/Odaja` by default, shown in the welcome with "Change". If it syncs to iCloud ("Desktop & Documents") or OneDrive, the app says so and suggests a folder that isn't synced (for example `~/Odaja`). A setting changes it later and can move existing homes (today only `ODAJA_HOME` does this).

## Open source rules

The repo is public, now and always. Everything is built so that's never a risk
and self-hosting stays real.

- **Assume attackers read the code.** Every limit, permission and credit check is enforced on the server. Checks in the page are only there to show friendly messages. Nothing depends on the code being secret.
- **No secrets in the repo, ever:** API keys, signing keys, webhook secrets and database passwords live in the host's and GitHub's secrets. `.env.example` holds only names and development placeholders.
- **Configuration, not constants:** prices, plan limits, credit rates, the free allowance, model choices and rate limits come from configuration (environment, the billing provider, a settings table), not from code. They can change without a commit, and the repo doesn't publish our business numbers.
- **Self-hosting works without our services:** the server needs only Postgres and an S3-compatible store (`docker compose up` runs both). Every outside service is optional and switched on by configuration: without email, sign-in is by password; without Google or GitHub apps, those buttons don't show; without Paddle there are no paid plans (everything unlocked); without Sentry or PostHog nothing is sent anywhere; without AI Gateway the server calls providers directly; without Turnstile sign-up still works.
- **No hard-coded domain:** our domain appears only in deployment configuration, so a fork runs on its own.
- **Telemetry is disclosed and off for self-hosters:** the hosted site says what it collects; a self-hosted build collects nothing unless its owner turns it on.
- **Kept outside the repo:** user data, AI cost measurements and pricing experiments, abuse-detection tuning, the early-supporter list, and anything else about the business or its customers. Plans in `docs/` describe how the product works, not the numbers behind it.
- **Contributions:** new contributors sign off their commits (DCO) and agree to the AGPL licence; a contributor agreement is decided before accepting outside code, if dual licensing might ever be needed.
- **Paid features are open too:** the code for sharing, teams and credits is in the repo. What people pay for is the hosted service (our AI, storage, uptime), not hidden code.

## The stack

**Stays:** Vite, React 19, React Three Fiber, Zustand, Zod 4, TypeScript, Bun; the AI SDK and Anthropic SDK in the page for your own key; the companion as one Bun binary. **Tailwind CSS 4** for new UI (`src/ui/primitives/`); the older `styles.css` screens move over when they're reworked (see AGENTS.md).

**The cloud server: portable, not tied to one provider**

| Need | Choice |
|---|---|
| API | **Hono** on Web standards (`backend/app.ts`), started by a thin entry per host: Bun today (`backend/entries/bun.ts`), Cloudflare Workers or others later without changing routes |
| Database | **Postgres** with **Drizzle ORM** (typed queries, migrations) |
| Files, assets, versions | any **S3-compatible** store (Cloudflare R2 in production; `ferdzo/fs` or MinIO locally), stored by content hash |
| Live reload between tabs | Server-Sent Events from the API (Postgres `LISTEN/NOTIFY` once there's more than one server) |
| Background work | a job queue in Postgres (emails, thumbnails, thinning versions, cleaning up unused content) |
| Bot protection | **Turnstile** (optional) |
| AI on our key | the AI SDK in the server, optionally through **Cloudflare AI Gateway** (logs, cost per user, rate limits, caching) |
| Remote MCP (later) | a Streamable HTTP `/mcp` endpoint on the same server, signing in with OAuth (Better Auth's OAuth provider), running the server-side tools |
| Running it | a container on any host, chosen in phase 0 (with managed Postgres and R2); `compose.yml` for development and self-hosting |

**Other services**

| Need | Choice |
|---|---|
| Sign-in, teams, invitations | **Better Auth** (open source, Postgres through Drizzle; email and password, email links, Google, GitHub; organization plugin for members, roles and invitations) |
| Payments | **Paddle** (merchant of record: EU VAT, invoices, seats). Stripe with Stripe Tax is the alternative. Decided in phase 0. |
| Email | **Resend** + React Email (optional) |
| Errors | **Sentry** (optional) |
| Product analytics | **PostHog** (EU hosting, optional) |

**Code layout:** `backend/` next to `src/`, importing the shared model (`src/model`, the operations, the tools) directly. A monorepo (`packages/core`, `apps/…`) only when something actually can't be shared this way, for example if the server moves to Workers and needs the core free of DOM, Node and Bun APIs.

## How it fits together

```
 Browser (website or companion page)                    Cloud server (container)
 ┌─────────────────────────────────────┐   HTTPS   ┌────────────────────────────────────┐
 │ ui · 3D · chat                      │─────────▶│ Hono: auth, homes, files, versions, │
 │ platform: local (browser | folders) │           │ shares, teams, billing webhooks     │
 │           + cloud homes when signed │◀─ SSE ───│ tools on cloud homes (ctx.files)    │
 │             in                      │           │ AI proxy ─▶ (AI Gateway) ─▶ models  │
 └──────┬──────────────────────────────┘           │ /mcp (later)                       │
        │ own key: straight to the provider        ├────────────────────────────────────┤
        ▼                                          │ Postgres: users, workspaces, homes, │
   Anthropic · OpenAI · Gemini · …                 │ versions, shares, credits ledger    │
                                                   │ S3 / R2: blobs/<sha256>             │
 Companion (localhost:5180)                        └────────────────────────────────────┘
   local folders · Claude Code · MCP
   cloud homes: through the cloud server
```

- **Cloud homes sit next to local ones** behind `src/platform.ts`: the local host (browser storage on the website, folders in the companion) is always there, and signing in adds the cloud's homes to the same list. Opening a home picks where its files live; most of the app doesn't change.
- **Your own key** never touches the server. **Our AI**: the browser sends the chat request to the server, which checks credits, calls the model, runs the tools on the home, streams the reply and records the cost.

## Data model (Postgres)

| Table | Holds |
|---|---|
| `user`, `session`, `account`, `verification` | Better Auth |
| `projects` (homes) | owner (later workspace), folder, name, thumbnail, private flag, **the current manifest** (path → content hash, size), size, deleted |
| `versions` | home, manifest, time, reason (autosave, before AI, named, before restore), label, author |
| `workspaces`, `memberships`, `invitations` | teams (phase 7): personal or team, plan, seats, roles, invites |
| `folders`, `folder_access` | team folders, which are restricted and who can see them |
| `shares` | home, scope (whole home or a scene path), who (user, email invite or link token), role, expiry, password hash, allow copy, created by |
| `credit_ledger` | workspace, user, change, reason (allowance, top-up, AI reply with model and tokens), time |
| `subscriptions` | workspace, plan, status, seats, period, Paddle ids |
| `ai_usage` | per reply: user, home, model, tokens in and out, cached tokens, cost |

**Storage:** `blobs/<sha256>`, one immutable object per file content (JSON and other text compressed). Identical files are stored once across versions and homes, and can be cached forever. Never public: served through the server after an access check, or by short-lived signed URLs. A blob that no home and no kept version uses is deleted by the cleanup job.

**One access check** in the server, used by every route: owner or admin → workspace member (unless the home or folder is restricted or private) → explicit folder or home access → share. It returns what the person can do: view, edit the whole home, or edit one scene.

## Saving and conflicts

- **Reading** a file returns its content and its fingerprint (`ETag`, the SHA-256 of the content). The app remembers the fingerprint of each file it has.
- **Saving** sends the new content with `If-Match: <the fingerprint it replaces>` (or `If-None-Match: *` for a new file). The server stores the content under its hash if it's new, and moves the path in the home's manifest to it, in one transaction that checks the fingerprint is still current.
- **Refused** (`412`): someone else saved first. The app reloads that file, keeps the newer version, and says so. Nothing is overwritten silently; the overwritten work is still in history if the other save came from the same person.
- **Versions:** before a save, when the last version is more than a few minutes old and the home has changed since, the current manifest is recorded as a version. Before each AI reply, before a restore and on "Name this version", one is recorded straight away. Restoring makes the old manifest current again; everyone open reloads.
- **Live reload:** the server tells open tabs which files changed (Server-Sent Events), and they reload them, as the companion does with files changed on disk.
- **Assets** (images, models, textures) are stored the same way; scene files keep referring to them by path.

## Real-time editing (later)

When people ask for it, live changes replace saving whole files:

- **Documents are records with ids:** walls, openings, rooms, objects, materials, levels, stairs, roofs, garden areas. Lists that are positional today get stable ids, with a migration in `docs/project-format.md`, so concurrent adds and deletes don't clash.
- **Operations stay as they are** (functions from document to document). The client diffs before and after into **record patches** (set a record, delete a record, set a field). This fits today's undo entries.
- **The loop:** the client applies its change at once and sends the patches with the last sequence number it has seen; the home's coordinator validates them (openings on existing walls, attached furniture, valid stairs and roofs, scene editors not touching the shell), numbers and broadcasts them, or rejects them with a reason; clients rebase their pending patches.
- **Conflicts:** last write wins per field; a record deleted by one person and edited by another stays deleted; a merge that leaves geometry invalid is repaired by the coordinator.
- **Undo per person**, **presence** over the same connection (never stored), and **persistence** into the same content store and versions as above.
- **Where it runs:** one coordinator per home. In a single server process that's an in-memory room per open home; with several servers, homes are pinned to one (or Cloudflare Durable Objects, if the server has moved to Workers).
- **Reference:** tldraw sync (open source) is worth reading; check its licence before reusing any code.

## Phases

Each phase leaves the website and the companion working, ends with typecheck, tests and a check in the browser, and is deployed to **staging** before production.

**0. Decisions and spikes (before launch work)**
- The domain (browser storage is tied to it, so it's chosen before anyone uses the cloud version). Plan for moving users' homes off the GitHub Pages address (see "Changing the address later" in web-plan.md).
- Where the server runs (a container host, managed Postgres, R2) and staging next to production.
- Licence change to AGPL, after every past contributor agrees; trademark the name.
- Spikes, each a throwaway: Paddle checkout and a seat change through a webhook; the AI proxy streaming through AI Gateway with cost recorded.
- **Measure AI cost:** run 20 typical first prompts ("build from this plan", "furnish the living room") on candidate models; record quality, tokens and cost. Choose the free-allowance model and the credit rate from this.
- Early-supporter page live.
- Done when: the domain is registered, the host is chosen, the licence is changed, and each spike works or has a replacement. Measurements and pricing notes from this phase are kept outside the repo.

**1. Accounts and cloud homes, one person** (done, on `master`; what was checked is in [cloud-platform.md](cloud-platform.md))
- The server: Hono, Postgres with Drizzle, S3 storage by content hash, `compose.yml` for development.
- Better Auth: email and password, email links, Google and GitHub, each on when configured; email verification and password reset when email is set up; rate limits; Turnstile on sign-up.
- Signing in from the app, with no login wall: cloud homes in the home list next to local ones; new cloud home; "Copy to your account"; `.odaja` import and export for cloud homes.
- The furniture library stays the computer's (browser storage or the companion's folder); placing an item copies its files into the home, so a cloud home is complete everywhere. A library kept in the account comes with teams (the team library).
- Saving with `If-Match`, versions (automatic, before AI, named, restore), the History panel, live reload between tabs, the Saved / Saving / Offline status (changes wait in the tab while offline and go out when it's back).
- Thinning old versions and cleaning up unused content.
- Done when: a home edited on one computer is there on another, a second tab can't overwrite it silently, any version can be restored, and the website without an account behaves exactly as before.

**2. Deployed**
- Staging and production with separate data and secrets; the website on the new domain, built with `VITE_CLOUD_API_URL` (its CSP then allows the API and Turnstile by itself).
- Secrets per environment: `BETTER_AUTH_SECRET` (the server refuses to start in production without its own), Turnstile keys, Resend, Google and GitHub apps.
- Database migrations: development uses `bun run db:push`; staging and production apply generated migrations (`bun run db:generate`), checked in and run on deploy.
- Ready for more than one server process: change events through Postgres `LISTEN/NOTIFY` (today they're in memory, so tabs only hear saves made through the same process), and thinning versions and cleaning up unused content as a job that runs once (today each process runs it hourly).
- An upload size limit on saving files (today only Bun's default), before the server is public.
- GitHub Actions: test, then deploy to staging on `master`, to production on a release tag.
- Sentry and PostHog, with no cookies before consent.
- Done when: a deploy goes through staging to production, and the website runs from the new domain.

**3. Tools on the server, the prompt-first start and AI credits**
- The agent tools running on the server against cloud homes (`ctx.files()` over storage), used by the in-app chat for cloud homes; screenshots asked of an open tab.
- The prompt-first screen with uploads and examples, and the live build with step-by-step progress.
- The AI proxy with credits and a ledger; the free starter allowance; step caps; per-user rate limits; prompt caching. (A version before each AI reply is already kept, since phase 1.)
- Your own key stays browser-direct and needs no login.
- The out-of-credits choice: top up, add your own key, or wait.
- Done when: a new visitor goes from a prompt to a built home in one flow on the free allowance, the cost of every reply is recorded, nobody can spend past their ceiling (tested with parallel requests), and an AI turn can be undone from history.

**4. Sharing**
- Viewer links that open without an account; Make a copy; whole home or one scene; expiry, password, allow copy.
- Shares by email (with invites); editors, with the `If-Match` check; walls read-only for scene editors; "Shared with me" in the home list; emails on sharing.
- Done when: a viewer link opens with no account, a copy is independent of the original, a scene editor can't change walls, and two editors saving the same file never lose each other's work silently.

**5. Payments**
- Paddle: Pro monthly and yearly, top-ups, the early-supporter price; webhooks to `subscriptions` and credits; plan limits (cloud homes, history length, sharing features); invoices and the customer portal.
- Done when: buying Pro on staging (Paddle sandbox) unlocks it at once, cancelling ends it at the period's end, and a top-up adds credits.

**6. The companion, signed in, and remote MCP**
- Sign-in in the companion; cloud homes next to folders; Claude Code and MCP tool calls on a cloud home go to the cloud server's tools, with the user's permissions.
- "Move to my account" and "Download as a folder".
- Local version history for folder homes (`.odaja/versions/`).
- The homes folder setting, with iCloud and OneDrive detection and moving existing homes.
- Remote MCP: `/mcp` on the cloud server with OAuth, so Claude, ChatGPT and others can edit cloud homes with no tab open.
- Done when: Claude Code furnishes a cloud home from the companion while it's open on the website, claude.ai changes a cloud home through remote MCP, and a local home keeps working with no account and no network.

**7. Teams**
- Better Auth organizations: team workspaces, invitations, roles; the workspace switcher.
- Folders, restricted folders and homes, private drafts; moving homes between workspaces; guests.
- Seat billing in Paddle (minimum 2, prorated), pooled credits with per-member limits, the team library.
- Team admin and billing screens on the website.
- Done when: a team of three works on shared homes, a restricted folder is invisible to a member without access, removing a member keeps their homes, and seats bill correctly.

**8. Ready for launch**
- **Privacy and GDPR:** privacy policy and terms, data stored in the EU, export all my data, delete my account and homes, cookie-free analytics or consent.
- **Abuse:** rate limits on every route, upload size and type checks, link-share abuse reporting, spend alerts.
- **Operations:** backups (Postgres point-in-time recovery, storage lifecycle), a status page, alerts, a runbook for restoring a home.
- **Load:** many homes being saved at once, a burst of sign-ups.
- Docs: README, AGENTS.md, `docs/project-format.md` and a help page.
- Done when: the checklist above is complete on production and the early supporters are invited.

**Later**
- Editing together in real time (see above), with presence.
- Comments pinned to objects, walls or a spot, with email notifications.
- A headless renderer for screenshots without an open tab.
- Quote and quantity PDFs, high-resolution renders (Pro).

## Testing

- **Self-hosting:** CI starts the server with only Postgres and S3 (every optional service off) and runs the end-to-end tests against it.
- **Model (unit):** every operation and the checks, as today.
- **Server:** `bun test` against `compose.yml`'s Postgres and S3: access checks for every role and share type (including "a scene editor can't change the shell" and "a removed member loses access"), `If-Match` under parallel saves, versions and restore, cleanup never deleting content a version uses, credits under parallel spending, webhooks replayed from fixtures.
- **End to end:** Playwright against staging: two tabs saving one home (the second is refused and reloads), sign-in keeping the prompt, purchase in the Paddle sandbox, viewer links without an account, the companion's Claude Code changing a cloud home.
- **AI quality and cost:** the set of first prompts from phase 0 is re-run when the model, the prompt or the tools change, recording quality, cost and step count.
- **Manual:** the browser check at the end of each phase, on Chrome, Safari and Firefox, and on a phone for viewing.

## Security

- One access check for every route; storage never public.
- Your own API keys never leave the browser; our AI keys only in the server's secrets; no Claude credentials anywhere.
- Secrets in the host's and GitHub's secrets, never in the repo (it's public); a secret scanner runs in CI.
- Nothing relies on the code being secret (see "Open source rules").
- Sessions in `HttpOnly` cookies; rate limits on sign-in, sign-up and every route; Turnstile on sign-up and on the first free AI use.
- Saves checked with `If-Match`; uploads checked for size and type; paths checked so a file can't escape its home; `.odaja` unpacking keeps its existing checks.
- The CSP lists only our API and the AI providers.
- The companion's `/api` keeps its Origin and Host checks; tool calls on a cloud home carry the signed-in user's permissions.

## Not doing (now)

- Real-time editing in the first versions (see "Later").
- A CRDT (Yjs, Automerge): when real-time editing comes, the server-authoritative approach fits Odaja better.
- Tying the server to one provider (Workers-only, D1, Durable Objects).
- A monorepo before something needs it.
- A desktop app (Tauri, Electron): set aside.
- A local mirror of cloud homes in the companion, and a sync engine for it.
- Making the companion depend on an account or the network.

## Things to verify early

- **Better Auth** email links, Google and GitHub alongside passwords, and its organization plugin for teams.
- **Paddle:** seat changes, proration and top-ups fit the plans; payouts and VAT handling for where the business is registered.
- **Storage cost** of versions on a few real homes over some weeks (expected: a few MB per home per year, dominated by images and models stored once).
- **AI cost per first prompt** on the chosen model, and how good the first result is.
- **The browser's Local Network Access prompt** doesn't affect the companion, which serves its own page.
- **Moving the site off GitHub Pages:** existing users' browser homes stay at the old address; they move them with `.odaja` files or a one-click hand-off.
