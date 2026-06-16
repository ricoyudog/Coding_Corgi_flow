import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const CLI = resolve(__dirname, "../../dist/corgispec.js");

describe("hooks generate", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = resolve(
      tmpdir(),
      `corgispec-hooks-generate-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("platform listing", () => {
    it("shows supported platforms when --platform is omitted", () => {
      const output = execSync(`node ${CLI} hooks generate`, { encoding: "utf-8" });
      expect(output).toContain("claude");
      expect(output).toContain("opencode");
      expect(output).toContain("codex");
      expect(output).toContain("Supported platforms");
    });
  });

  describe("invalid platform", () => {
    it("exits 1 for unsupported platform", () => {
      try {
        execSync(`node ${CLI} hooks generate --platform invalid`, { encoding: "utf-8" });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.status).toBe(1);
        const output = (err.stderr || "").toString();
        expect(output).toContain("Unsupported platform");
      }
    });
  });

  describe("Claude Code format", () => {
    it("outputs JSON with hooks key to stdout", () => {
      const output = execSync(`node ${CLI} hooks generate --platform claude`, {
        encoding: "utf-8",
      });

      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty("hooks");
      expect(parsed.hooks).toHaveProperty("SessionStart");
      expect(parsed.hooks).toHaveProperty("PreToolUse");
      expect(parsed.hooks).toHaveProperty("PostToolUse");
      expect(parsed.hooks).toHaveProperty("Stop");
      expect(parsed.hooks).toHaveProperty("PostCompact");
    });

    it("hooks reference corgispec hook subcommands", () => {
      const output = execSync(`node ${CLI} hooks generate --platform claude`, {
        encoding: "utf-8",
      });

      const parsed = JSON.parse(output);
      const sessionHook = parsed.hooks.SessionStart[0].hooks[0];
      expect(sessionHook.type).toBe("command");
      expect(sessionHook.command).toContain("hook session-start");
    });

    it("writes to output file when --output specified", () => {
      const outputPath = resolve(tempDir, "settings.json");

      execSync(
        `node ${CLI} hooks generate --platform claude --output ${outputPath}`,
        { encoding: "utf-8" }
      );

      expect(existsSync(outputPath)).toBe(true);
      const content = JSON.parse(readFileSync(outputPath, "utf-8"));
      expect(content).toHaveProperty("hooks");
    });

    it("merges into existing file without hooks key", () => {
      const outputPath = resolve(tempDir, "settings.json");
      writeFileSync(outputPath, JSON.stringify({ permissions: { allow: ["*"] } }, null, 2));

      execSync(
        `node ${CLI} hooks generate --platform claude --output ${outputPath}`,
        { encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(outputPath, "utf-8"));
      expect(content).toHaveProperty("hooks");
      expect(content).toHaveProperty("permissions");
    });

    it("rejects existing file with hooks key unless --force", () => {
      const outputPath = resolve(tempDir, "settings.json");
      writeFileSync(outputPath, JSON.stringify({ hooks: { old: true } }, null, 2));

      try {
        execSync(
          `node ${CLI} hooks generate --platform claude --output ${outputPath}`,
          { encoding: "utf-8" }
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.status).toBe(1);
        const output = (err.stderr || "").toString();
        expect(output).toContain("already contains");
        expect(output).toContain("--force");
      }
    });

    it("overwrites with --force", () => {
      const outputPath = resolve(tempDir, "settings.json");
      writeFileSync(outputPath, JSON.stringify({ hooks: { old: true } }, null, 2));

      execSync(
        `node ${CLI} hooks generate --platform claude --output ${outputPath} --force`,
        { encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(outputPath, "utf-8"));
      expect(content.hooks).toHaveProperty("SessionStart");
      expect(content.hooks).not.toHaveProperty("old");
    });
  });

  describe("OpenCode format", () => {
    it("outputs Claude-compatible bridge format by default", () => {
      const output = execSync(`node ${CLI} hooks generate --platform opencode`, {
        encoding: "utf-8",
      });

      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty("hooks");
      expect(parsed.hooks).toHaveProperty("SessionStart");
    });

    it("outputs TypeScript plugin with --deep", () => {
      const output = execSync(`node ${CLI} hooks generate --platform opencode --deep`, {
        encoding: "utf-8",
      });

      expect(output).toContain("import type { Plugin }");
      expect(output).toContain("CorgiSpecDeep");
      expect(output).toContain("hook session-start");
    });

    it("writes deep plugin to file with --output", () => {
      const outputPath = resolve(tempDir, "corgispec-deep.ts");

      execSync(
        `node ${CLI} hooks generate --platform opencode --deep --output ${outputPath}`,
        { encoding: "utf-8" }
      );

      const content = readFileSync(outputPath, "utf-8");
      expect(content).toContain("CorgiSpecDeep");
    });

    it("defaults to TypeScript plugin output (no --deep)", () => {
      const output = execSync(`node ${CLI} hooks generate --platform opencode`, {
        encoding: "utf-8",
      });

      expect(output).toContain("import type { Plugin }");
      expect(output).toContain("CorgiSpecDeep");
      expect(output.trimStart()).not.toMatch(/^{/);
    });

    it("plugin output includes PreToolUse handlers", () => {
      const output = execSync(`node ${CLI} hooks generate --platform opencode`, {
        encoding: "utf-8",
      });

      expect(output).toContain("tool.execute.before");
      expect(output).toContain("hook pre-write");
      expect(output).toContain("hook pre-bash");
    });

    it("--deep flag is no-op (produces same output as default)", () => {
      const defaultOutput = execSync(`node ${CLI} hooks generate --platform opencode`, {
        encoding: "utf-8",
      });
      const deepOutput = execSync(`node ${CLI} hooks generate --platform opencode --deep`, {
        encoding: "utf-8",
      });

      expect(deepOutput).toBe(defaultOutput);
    });
  });

  describe("Codex format", () => {
    it("outputs TOML and Python wrappers to stdout", () => {
      const output = execSync(`node ${CLI} hooks generate --platform codex`, {
        encoding: "utf-8",
      });

      expect(output).toContain("[features]");
      expect(output).toContain("hooks = true");
      expect(output).toContain("[[hooks.");
      expect(output).toContain("#!/usr/bin/env python3");
      expect(output).toContain("corgispec_session_start.py");
    });

    it("writes config.toml and hook scripts to output directory", () => {
      const outputDir = resolve(tempDir, ".codex");

      execSync(
        `node ${CLI} hooks generate --platform codex --output ${outputDir}`,
        { encoding: "utf-8" }
      );

      expect(existsSync(resolve(outputDir, "config.toml"))).toBe(true);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_session_start.py"))).toBe(true);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_pre_write.py"))).toBe(true);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_pre_bash.py"))).toBe(true);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_post_write.py"))).toBe(true);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_stop_check.py"))).toBe(true);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_post_compact.py"))).toBe(true);

      const toml = readFileSync(resolve(outputDir, "config.toml"), "utf-8");
      expect(toml).toContain("hooks = true");

      const wrapper = readFileSync(resolve(outputDir, "hooks/corgispec_pre_bash.py"), "utf-8");
      expect(wrapper).toContain("hook");
      expect(wrapper).toContain("pre-bash");
    });

    it("rejects existing config.toml unless --force", () => {
      const outputDir = resolve(tempDir, ".codex");
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(resolve(outputDir, "config.toml"), "existing = true\n");

      try {
        execSync(
          `node ${CLI} hooks generate --platform codex --output ${outputDir}`,
          { encoding: "utf-8" }
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.status).toBe(1);
        const output = (err.stderr || "").toString();
        expect(output).toContain("already exists");
        expect(output).toContain("--force");
      }
    });
  });
});
