import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const apiPort = process.env.MIMICOPY_API_PORT ?? "5174";
const clientHost = process.env.MIMICOPY_CLIENT_HOST ?? "127.0.0.1";
const clientPort = Number(process.env.MIMICOPY_CLIENT_PORT ?? 8080);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: clientHost,
    port: clientPort,
    strictPort: true,
    allowedHosts: ["mimicopy.plinponick.com"],
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
      "/media": `http://127.0.0.1:${apiPort}`
    }
  },
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**"],
    globals: true,
    setupFiles: "./vitest.setup.ts"
  }
});
