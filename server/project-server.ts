// In development, Vite serves the app and this plugin mounts Odaja's backend
// (server/api.ts) at /api. The standalone server (server/main.ts) mounts the
// same backend next to the built app.
import type { Plugin } from "vite";
import { createOdajaApi } from "./api";

export function odajaProjectServer(): Plugin {
  return {
    name: "odaja-project-server",
    async configureServer(server) {
      const api = await createOdajaApi({ port: () => server.config.server.port ?? 5173 });
      server.httpServer?.on("close", () => api.stop());
      server.middlewares.use("/api", (req, res) => void api.handle(req, res));
    },
  };
}
