import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { odajaProjectServer } from "./server/project-server.ts";

export default defineConfig({
  plugins: [react(), odajaProjectServer()],
  server: { port: 5173 },
});
