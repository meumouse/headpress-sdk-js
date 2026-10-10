import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// The registry has no Next app of its own; lint it with the eslint-config-next the starter installs,
// so the components pass the same React Compiler rules a fresh Next 16 store runs on them.
// `pnpm registry:lint` from the repo root (needs `pnpm install`, which installs apps/starter).
const require = createRequire(new URL("../apps/starter/package.json", import.meta.url));
const { defineConfig, globalIgnores } = require("eslint/config");
const nextVitals = require("eslint-config-next/core-web-vitals");
const nextTs = require("eslint-config-next/typescript");

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      "import/resolver": { typescript: { project: fileURLToPath(new URL("./tsconfig.json", import.meta.url)) } },
    },
    rules: {
      // Not a Next app: there is no pages directory to check links against.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  globalIgnores(["**/public/**"]),
]);
