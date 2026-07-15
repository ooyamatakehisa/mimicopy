import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const apiPort = process.env.MIMICOPY_API_PORT ?? "5174";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 8080,
    strictPort: true,
    allowedHosts: ["mimicopy.plinponick.com"],
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
      "/media": `http://127.0.0.1:${apiPort}`
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts"
  }
});
