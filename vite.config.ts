import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { odajaProjectServer } from "./server/project-server.ts";
import { contentSecurityPolicy, serviceWorker } from "./scripts/webBuild.ts";

export default defineConfig({
  // Relative asset paths: the same build works at any address — a domain's
  // root, a sub-path (GitHub Pages: /odaja/), or the companion's localhost.
  // Moving Odaja to another domain needs no code change.
  base: "./",
  plugins: [react(), odajaProjectServer(), contentSecurityPolicy(), serviceWorker()],
  server: { port: 5173 },
});
