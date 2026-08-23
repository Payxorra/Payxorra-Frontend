import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The PWA service worker is emitted by Serwist into public/ at build
    // time. It is minified, third-party-runtime code; ESLint does not need
    // to lint it. Keep the rule permissive enough that future Serwist
    // filename variations (e.g. sw.js.map, workbox-*.js) do not regress.
    "public/sw.js",
    "public/sw.js.map",
    "public/workbox-*.js",
  ]),

  {
    rules: {
      // React Compiler lint rules are too strict for the existing codebase and
      // currently flag established virtualization, WebSocket, and state-sync
      // patterns that still pass typecheck and production builds. Keep the
      // core Hooks rules from eslint-config-next enabled while disabling the
      // compiler-only rules so `npm run lint` remains actionable.
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      // The WebGPU ambient declarations and test helpers intentionally use
      // broad platform-shaped types that are impractical to narrow here.
      // Rules removed to enforce strict mode across the codebase.
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
]);

export default eslintConfig;
