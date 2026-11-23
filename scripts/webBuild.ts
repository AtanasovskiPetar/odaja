// Build steps for the website (vite.config.ts):
//  - a Content Security Policy in index.html: the page runs only its own
//    scripts and talks only to itself, the AI providers and local model servers
//    (and, when built with VITE_CLOUD_API_URL, the cloud server and Turnstile);
//  - the service worker (src/browser/serviceWorker.js) with the list of
//    every built file, so the app works offline after the first visit.
// Both use relative addresses only, so the build works at any address.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadEnv, type Plugin } from "vite";

// Where the in-app chat may send requests (src/agent/chat/). Local model
// servers are reached on this computer only.
const AI_PROVIDERS = ["https://api.anthropic.com", "https://api.openai.com", "https://generativelanguage.googleapis.com", "https://openrouter.ai"];
const LOCAL_SERVERS = ["http://localhost:*", "http://127.0.0.1:*"];

// Cloudflare Turnstile, the bot check on the cloud server's sign-up (src/cloud/turnstile.ts).
const TURNSTILE = "https://challenges.cloudflare.com";

export const contentSecurityPolicyFor = (cloudUrl?: string) => {
  // The cloud server: its API and the homes' files (images, models) come from it.
  const cloud = cloudUrl ? new URL(cloudUrl).origin : null;
  const also = (...sources: (string | null)[]) => sources.filter(Boolean).map((s) => ` ${s}`).join("");
  return [
    "default-src 'self'",
    // WebAssembly: the Draco decoder for compressed models.
    `script-src 'self' 'wasm-unsafe-eval'${also(cloud && TURNSTILE)}`,
    ...(cloud ? [`frame-src ${TURNSTILE}`] : []),
    // The Draco decoder and pdf.js run in workers; three.js makes the Draco one from a blob.
    "worker-src 'self' blob:",
    // React and three.js set inline styles.
    "style-src 'self' 'unsafe-inline'",
    // Files of the home are shown through blob: URLs (src/browser/platform.ts).
    `img-src 'self' data: blob:${also(cloud)}`,
    `media-src 'self' data: blob:${also(cloud)}`,
    "font-src 'self' data:",
    `connect-src 'self' data: blob: ${[...AI_PROVIDERS, ...LOCAL_SERVERS].join(" ")}${also(cloud)}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
};

export const CONTENT_SECURITY_POLICY = contentSecurityPolicyFor();

export function contentSecurityPolicy(): Plugin {
  let policy = CONTENT_SECURITY_POLICY;
  return {
    name: "odaja-csp",
    apply: "build", // the dev server injects its own inline scripts
    configResolved(config) {
      const cloudUrl = loadEnv(config.mode, config.envDir || config.root, "VITE_").VITE_CLOUD_API_URL?.trim();
      policy = contentSecurityPolicyFor(cloudUrl || undefined);
    },
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

async function walk(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(dir, rel)));
    else out.push(rel);
  }
  return out;
}

export function serviceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "odaja-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const files = (await walk(outDir)).filter((f) => f !== "sw.js" && !f.endsWith(".map") && !f.startsWith(".")).sort();
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update(await fs.readFile(path.join(outDir, f)));
      // index.html is cached as the scope itself ("./"), the address people open.
      const list = ["./", ...files.filter((f) => f !== "index.html")];
      const source = await fs.readFile(path.resolve(import.meta.dirname, "../src/browser/serviceWorker.js"), "utf8");
      await fs.writeFile(
        path.join(outDir, "sw.js"),
        source.replace("__VERSION__", hash.digest("hex").slice(0, 12)).replace("__FILES__", JSON.stringify(list)),
      );
    },
  };
}
