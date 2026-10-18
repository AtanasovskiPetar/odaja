# Odaja on the web: plan

Odaja becomes a **local-first web app**, in the spirit of Excalidraw. The
website is only the app: everything runs in the visitor's browser, and their
home stays on their computer. The desktop (Tauri) plan is parked; its first two
phases (the backend without Vite, and the `odaja-server` binary) become the
optional **companion**.

## What we agreed

**The website**
- Static files on GitHub Pages. No accounts, no database, no server holding anyone's data.
- **One home at a time** in the browser, like Excalidraw's one board.
  - It autosaves as you work.
  - First visit: the start screen (*Start a new home*, *Try the sample flat*, *Open a .odaja file*).
  - Coming back: straight into your home. The logo leads to the start screen, with *Continue "My flat"* at the top.
- Replacing the home (new, sample or open) when it has changes not in a file asks: **Save first / Don't save / Cancel**; otherwise it just replaces it. (Until after phase 7 the replaced home was also kept aside once as the *previous home*; that half-way slot was dropped: one home, and files for the rest.)
- **No start screen** (after phase 7): Odaja opens straight into the home. A one-time welcome covers the first visit (the sample, one room, a floor plan, a blank sheet, or a file); after that, new homes, files and (in the companion) other folders are in the home menu.
- A small dot by the name shows when the home has changes not yet saved to a file.
- **Address:** build and test on the GitHub Pages URL (`atanasovskipetar.github.io/odaja`). The final address is decided **before sharing with real users**, because browser storage is tied to it.

**Files**
- **Save (⌘S) → `My flat.odaja`.** A zip of today's project folder (`project.json`, `shell.json`, `shells/`, `scenes/`, `assets/`). It's self-contained: placed furniture carries its own copy.
  - In Chrome/Edge ⌘S writes back to the same file after the first save; elsewhere it downloads.
  - The save dialog has **"Include chat history"** (off by default).
- **Open a `.odaja` file** replaces the current home (with the prompt above).
- **Export** (for looking, not continuing): PNG/JPG of the plan or 3D view. A PDF for contractors comes from the separate contractor-export work. GLB maybe later.

**Library (your own furniture and materials)**
- Lives in browser storage, next to the home, and is shared by every home you open in that browser.
- **Opening a `.odaja` does not add its items to your library.** Odaja offers: *"This home uses 3 items that aren't in your library: … [Add all to my library] [Not now]"*. Placed objects and materials record which library item they came from, so Odaja can tell.
- **`Oak table.odaja-item`**: one item as a file, to send or keep. Opening it adds it to the library.
- **`My library.odaja-library`**: the whole library as a file, for backup or another computer.
- **No "library in a local folder" option.**

**AI**
- **The chat runs in the browser with the user's own API keys:** Anthropic, OpenAI, Google Gemini, OpenRouter. Local models are Ollama and LM Studio, which need their CORS setting.
- Keys stay in that browser and go only to their provider. The site loads no outside scripts (a strict Content Security Policy), so nothing else can read them.
- **The in-app Claude Code option is removed.** The Claude subscription is used by talking to Odaja **from Claude Desktop or Claude Code over MCP**, through the companion. That's Anthropic's own apps using a tool server, which is the intended use.

**The companion (`odaja-server`)**
- Optional download for power users.
- Serves the same app at `localhost:5180`, with projects as **real folders** (many at a time, as today), live file watching and MCP (`odaja-server mcp`).
- Opening a `.odaja` there unpacks it into a folder; saving zips the folder. **`.odaja` files are the bridge** between the website and the companion.
- Later idea: a "tab bridge", where the companion passes MCP tool calls into an open website tab so Claude can edit a browser-stored home directly. Not planned now.

## What happens to the desktop (Tauri) work

Phases 1–2 of the old plan added no Tauri code. What they built is kept as the companion:
- **The backend without Vite:** `server/api.ts`, `server/serve.ts`, `/api/events`.
- **The binary:** `odaja-server`, with `mcp` mode, `resources/` next to it, and the port file `~/.odaja/server.json`.

Its wording now says "companion". Two things only served the in-app Claude Code chat; they're removed in **phase 5**, together with that chat, so the current chat keeps working until its browser replacement exists:
- the login-shell PATH and `claude` lookup in `server/env.ts`,
- the "Path to claude" setting.

## Changing the address later

The website's address can change without touching code; only users' data needs care.

**In the code: nothing tied to an address**
- **Relative paths:** the build uses relative asset paths (`base: "./"` in `vite.config.ts`). The same `dist/` works at a domain's root, under a sub-path like GitHub Pages' `/odaja/`, and in the companion (checked all three).
- **Keep it that way:** anything added later uses `import.meta.env.BASE_URL` or relative URLs, never `/…` or a hard-coded domain. That includes the PWA manifest's `start_url` and `scope`, the service worker scope, and the Content Security Policy (`'self'`).

**Deploying to your own domain:** add `public/CNAME` with the domain, point the domain's DNS at GitHub Pages, and set it in the repo's Pages settings. The workflow and the build stay the same.

**API keys and the shared `github.io` address:** browser storage belongs to the origin, and every Pages site of one account shares it: `<user>.github.io/odaja` and `<user>.github.io/anything-else` are the same origin. Any page published under that account could read the chat's API keys (and the home). Fine while only Odaja is published there; before sharing widely, use an address Odaja has to itself (a custom domain, or a GitHub organisation used only for Odaja). Another reason to settle the address first.

**Users' data:** browser storage belongs to the exact address, so a new address starts empty.
- **Simplest:** choose the address before sharing (the plan already says so). Then nothing ever has to move.
- **Always possible:** save the home (`.odaja`) and the library (`.odaja-library`) to files, and open them at the new address.
- **If it moves after people use it,** build a one-click helper then. The old site shows "Odaja has moved", and a button hands the home and library to the new address in the browser (a cross-site hand-off with `postMessage`), with no files to manage.
- **GitHub Pages gotcha:** setting a custom domain on the *same* Pages site makes the old `github.io` address redirect immediately, so the old site can't show that banner, and users' data stays behind at the old address. To move gently:
  1. Publish the new domain as a separate Pages site first.
  2. Keep the old one up with the banner for a while.
  3. Redirect only after that.

## How it fits together

```
                 ┌──────────────── the same app (src/) ────────────────┐
                 │  UI · 3D · model · chat engine · agent tools          │
                 │                  │ Platform                           │
                 └──────────────────┼────────────────────────────────────┘
               BrowserPlatform      │       ServerPlatform
     (website: GitHub Pages)        │       (companion: localhost:5180)
     OPFS: homes/<id>/,             │       /api → server/api.ts → folders on disk
     library/; IndexedDB: settings, │       tools run on the server (also for MCP)
     API keys, save-file handle     │       file watching → /api/events
```

- **Host detection at startup:** if `/api/projects` answers, it's the companion; otherwise the browser host. Same build for both.
- **Browser storage:**
  - **OPFS** (the browser's private file system) keeps the home in exactly today's folder layout, so saving a `.odaja` is just zipping a folder.
  - **IndexedDB** keeps settings, API keys, the ⌘S file handle and home metadata (name, last saved, unsaved changes).
- **One set of agent tools** (today's `server/tools.ts`) moves to `src/agent/`. It works on a small storage interface (read, write, list, remove, for the home and for the library) instead of Node's `fs`:
  - On the website the tools run in the browser.
  - In the companion they run on the server, for both the in-app chat and MCP.
  - Photo editing (`jimp`) runs in both; `node:crypto` hashes become Web Crypto.
- **One chat engine in the browser** for both hosts. It calls tools locally (website) or via `/api/tools/call` (companion). Conversations are stored with the home (`.odaja/chats/`, through the platform).

## Phases

Each phase leaves the app working, and ends with typecheck, build and a check in the browser.

**1. Browser storage and the one-home website** — done
- Also built here: the library in browser storage (save, preview, place, add material). Phase 3 adds item and library files and the "Add to my library" offer on top.
- "Save to file" isn't offered yet. The replace prompt says the home is kept as the previous one; **Save** joins it in phase 2.
- **Platform:** a storage interface with an OPFS implementation, `BrowserPlatform`, and host detection.
- **The home:** the current-home slot, the previous-home slot, autosave, the unsaved-changes dot and the replace prompt.
- **The start screen** for the website: new (room / floor plan / blank), sample, open file.
- **The sample flat** is bundled into the static build.
- In this phase the chat is hidden on the website.
- Done when: `vite build` served as plain static files (no `/api`) lets you create, edit, reload and continue a home. The companion and dev mode behave as today.

**2. `.odaja` files** — done
- The file menu sits on the home's name in the sidebar, with the unsaved dot. Opening: the menu, ⌘O, the start screen, or dropping a file on the app.
- Image export renders at full screen resolution and embeds the serif font, so exported plans keep their lettering.
- **Format:** zip and unzip with `fflate`. Document it in `docs/project-format.md`.
- **Save:** ⌘S, with a File System Access handle in Chrome/Edge and a download elsewhere. "Include chat history" in the save dialog.
- **Open,** with the replace prompt.
- **Export** PNG/JPG through the existing capture.
- **Companion:** open = unpack into a folder, save = zip the folder.
- Done when: a home saved on the website opens in the companion and back, unchanged.

**3. Library in the browser** — done
- Saving an item as a file works from the library panel (per item, or the whole library) and from the inspector ("Save as file", without adding it to your library). Items come back under their original id, so a home never offers the same item twice.
- **Storage:** OPFS `library/<id>/` (`item.json`, `model.glb`, `preview.png`, textures). The existing save-to-library, place and add-material flows run on it.
- **Provenance:** a schema field on objects and materials, `libraryItem`, the id it came from.
- **The "Add N items to my library" offer** when a home is opened.
- **Files:** `.odaja-item` and `.odaja-library`, import and export.
- Done when: a table made in one home is placed in another, survives replacing the home, travels by item file to a fresh browser profile, and is offered when a home using it is opened.

**4. Agent tools in the browser** — done
- Photo editing in the browser uses a canvas instead of `jimp`, whose browser build is an empty stub. That also keeps `jimp` out of the website.
- `?host=browser` runs dev as the website, and dev exposes the tool client as `window.odajaTools` for tests.
- **Move** `server/tools.ts` and `server/photos.ts` to `src/agent/`, on the storage interface (Node and OPFS implementations). Screenshot and open-scene become direct calls in the browser.
- **The server** uses the same module, so `/api/tools/call` and MCP are unchanged.
- Done when: every tool runs against a browser-stored home (checked with a script), and MCP from Claude Code still edits a companion folder live.

**5. The chat in the browser; Claude Code runner removed** — done
- The engine is `src/agent/chat/`, loaded the first time the chat is used. It asks for Odaja's tools through `src/agent/client.ts`, so the same code runs on the website (tools in the page) and in the companion (tools on the server; the chat's photos go along with a tool call that names one).
- Conversations go through `platform.chats` (`.odaja/chats/` in browser storage or the folder); saving one doesn't mark the home unsaved.
- Keys saved in the companion's old `~/.odaja/settings.json` aren't carried over: enter them again in the chat's settings (the file can be deleted).
- New homes from a floor plan hand the plan to the chat when an API key is set; otherwise they start with setting the scale to trace by hand.
- Checked with a fake model server (OpenAI-compatible, and the Anthropic API through the page's fetch): tool loops, a photo used by a tool, saving and reopening, on the website and in the companion. A conversation with a real key is still to do.
- **The engine:** move the provider runners and model lists from `server/chat/` to the browser (the Anthropic SDK in browser mode, the AI SDK for the others).
- **Settings:** keys and settings in IndexedDB, with the settings dialog adjusted. Tools are called locally or through the companion. Conversations are stored with the home.
- **Remove:**
  - the server chat routes and the Claude Code runner,
  - the login-shell PATH and `claude` lookup in `server/env.ts`,
  - the "Path to claude" setting.
- **Hints** for Ollama and LM Studio CORS.
- Done when: a real tool-using conversation works on the website with an API key, and the same in the companion.

**6. Ready for the web** — done
- **To go live:** in the repo's Settings → Pages, set Source to "GitHub Actions" once. Every push to `master` then publishes `https://<user>.github.io/odaja/` (`.github/workflows/pages.yml`).
- **Offline:** the service worker keeps a copy of every built file (listed at build time) and the two newest versions, so a page opened before an update still loads its parts. The page itself comes from the network first.
- **Private windows** can only be recognised in Firefox; Chrome and Safari deliberately hide them, so the start screen also says it in words.
- **The policy** limits local model servers to `localhost` and `127.0.0.1`; one elsewhere on the network would be refused.
- Checked on the static build (with the server stopped for offline): the sample and the chat open offline; Draco's WebAssembly, blob workers and files, and a PDF plan work; outside scripts, outside requests and `eval` are refused; the companion serves the same build without the offline copy.
- **Installable and offline:** a PWA (manifest and service worker), with relative `start_url` and `scope` (see "Changing the address later").
- **Keeping data:** a persistent-storage request, a Safari "Add to Dock" nudge, and a private-window warning ("nothing is kept").
- **Security:** a strict Content Security Policy.
- **Deploy:** a GitHub Pages workflow on pushes to `master`, with the right base path.
- Done when: the site is live on the GitHub Pages URL, works offline after the first visit, and refuses outside scripts.

**7. Companion release and docs** — done
- **To release:** set `version` in `package.json`, commit, then `git tag v<version>` and push the tag. The workflow checks they match.
- The macOS builds are signed ad hoc but not notarised; the README says how to clear the download quarantine. Notarising needs an Apple Developer account (later, if people ask).
- Checked locally: archives for macOS, Linux and Windows; the unpacked macOS build serves the app and answers MCP (30 tools) with a bare `PATH`, the way Claude Desktop starts it.
- **Still open:** the final web address (see "Changing the address later").
- **Releases:** a GitHub Actions workflow that builds `odaja-server` for macOS (Apple Silicon and Intel), Windows and Linux on version tags and publishes it to GitHub Releases.
- **Docs:** how to connect Claude Desktop and Claude Code to `odaja-server mcp`. Update `AGENTS.md`, `README.md` (with screenshots) and add a `LICENSE` (MIT).
- **Before telling anyone:** decide the final web address.

## Not doing (now)

- Tauri desktop app (phases 3–5 of the old plan): parked.
- Several homes in the browser at once: the storage is laid out so this could be added later.
- Library in a local folder (decided against).
- Accounts and sync: could be layered on top later if users ask.

## Things to verify early

- **Safari's private file system (OPFS):** writing from the main thread needs a recent Safari. The fallback is writing from a worker, or storing files in IndexedDB.
- **CORS:** every provider must answer browser calls directly, OpenAI especially. Check before building the chat engine.
- **Size:** `jimp` and the AI SDKs in the browser bundle; load them only when the chat or photo tools are used.
- **Big models:** large GLB files in OPFS. Watch the storage estimate and warn when space runs low.
