import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/modules/**", "src/app/**"],
    rules: {
      // WordPress serves responsive images (srcset/sizes) already; next/image would resize them again.
      "@next/next/no-img-element": "off",
    },
  },
  {
    // Components installed from the Headpress registry (shadcn CLI), kept as the CLI wrote them.
    // They trip the React Compiler rules eslint-config-next 16 turns on; reported upstream, kept
    // visible as warnings until the registry is fixed.
    files: ["src/components/headpress-*.tsx"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
