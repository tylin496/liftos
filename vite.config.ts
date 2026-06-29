import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// GitHub Pages serves the app under /LiftOS/. Vercel hosts the /api/* functions.
// Local dev proxies /api to the existing mock dev-server (npm run mock-api → :8765).
export default defineConfig(({ command }) => ({
  // GitHub Pages serves under /LiftOS/; dev serves from root so previews work.
  base: command === "build" ? "/LiftOS/" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
      "@features": fileURLToPath(new URL("./src/features", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
}));
