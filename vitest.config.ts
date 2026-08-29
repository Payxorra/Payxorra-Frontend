import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest has no config of its own yet; the `@/*` alias mirrors tsconfig.json
// so hook/service tests (e.g. src/hooks/tests/**) can resolve it like Next.js does.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/tests/**/*.test.ts", "src/**/tests/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
