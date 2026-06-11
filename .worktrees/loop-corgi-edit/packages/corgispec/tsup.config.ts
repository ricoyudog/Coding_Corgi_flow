import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin/corgispec.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  splitting: true,
  sourcemap: true,
  dts: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  outExtension: () => ({ js: ".js" }),
});
