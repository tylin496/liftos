import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// GitHub Pages serves the app under /liftos/ (repo name).
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/liftos/" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
      "@features": fileURLToPath(new URL("./src/features", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
  },
}));
