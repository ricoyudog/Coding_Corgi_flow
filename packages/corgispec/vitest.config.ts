import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Commander entrypoints are exercised as real child processes by the
      // lifecycle/hook integration suites. V8 data from those processes is not
      // visible to Vitest's worker, so the aggregate gate covers the reusable
      // library core while process tests gate the CLI boundary separately.
      exclude: ["src/bin/**", "src/commands/**"],
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        lines: 45,
        statements: 45,
        branches: 84,
        functions: 76,
        "src/lib/openspec-adapter.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/openspec-runtime.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/artifact-resolver.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/planning-revision.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/readiness.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/task-groups.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/run-contract-v2.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/loop-reducer-v2.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/loop-store-v2.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/evidence-v2.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/loop-successor-v2.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/canonical-convergence-evidence-v2.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/convergence-intent-v2.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/convergence-lock-v2.ts": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
      },
    },
  },
});
