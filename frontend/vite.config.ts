import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The frontend imports TypeScript source from ../shared and ../mocks,
// so Vite needs permission to serve files above its root.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: "0.0.0.0",
    fs: { allow: [path.resolve(__dirname, "..")] },
  },
  resolve: {
    alias: {
      "@bel/shared": path.resolve(__dirname, "../shared/types/index.ts"),
      "@bel/mock-api": path.resolve(__dirname, "../mocks/mock-api/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
