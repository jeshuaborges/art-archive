import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` builds the app and serves everything through `wrangler dev`.
// `npm run dev:ui` gives hot reload for UI work, proxying the API to wrangler.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787", "/img": "http://localhost:8787", "/mcp": "http://localhost:8787" },
  },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
} as never);
