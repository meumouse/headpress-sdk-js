import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
    typecheck: { enabled: true, include: ["test/**/*.test-d.ts"] },
  },
});
