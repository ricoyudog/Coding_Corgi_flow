import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/bin/**"],
    },
  },
});
