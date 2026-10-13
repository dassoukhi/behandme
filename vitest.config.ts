import { defineConfig } from "vitest/config";

export default defineConfig({
  // Library aliases (@lib/*) come from the "paths" of tsconfig.json.
  resolve: { tsconfigPaths: true },
  test: {
    include: ["{apps,libs}/*/src/**/*.spec.ts"],
  },
});
