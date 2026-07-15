import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

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
      const stopCommands = parsed.hooks.Stop.flatMap((entry: any) =>
        entry.hooks.map((hook: any) => hook.command)
      );
      expect(stopCommands.some((command: string) => command.includes("hook loop-check"))).toBe(true);
    });

    it("passes Stop hook stdin, stdout, stderr, session, and exit code through Claude command config", () => {
      const fakeBin = resolve(tempDir, "claude-bin");
      const fakeCorgispec = resolve(fakeBin, "corgispec");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(fakeCorgispec, `#!/usr/bin/env node
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  process.stdout.write("CLAUDE-OUT:" + input);
  process.stderr.write("CLAUDE-ERR:" + process.argv.slice(2).join(" "));
  process.exitCode = 7;
});
`);
      chmodSync(fakeCorgispec, 0o755);
      const env = { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}` };
      const generated = execSync(`node ${CLI} hooks generate --platform claude`, {
        encoding: "utf8",
        env,
      });
      const config = JSON.parse(generated);
      const loopCommand = config.hooks.Stop
        .flatMap((entry: any) => entry.hooks)
        .find((hook: any) => hook.command.includes("hook loop-check")).command;
      const payload = JSON.stringify({ session_id: "claude-session", stop_hook_active: false });
      const result = spawnSync(loopCommand, {
        shell: true,
        input: payload,
        encoding: "utf8",
        env,
      });
      expect(result.status).toBe(7);
      expect(result.stdout).toBe(`CLAUDE-OUT:${payload}`);
      expect(result.stderr).toBe("CLAUDE-ERR:hook loop-check");
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
    it("outputs TypeScript plugin by default", () => {
      const output = execSync(`node ${CLI} hooks generate --platform opencode`, {
        encoding: "utf-8",
      });

      expect(output).toContain("import type { Plugin }");
      expect(output).toContain("CorgiSpecDeep");
    });

    it("outputs TypeScript plugin with --deep", () => {
      const output = execSync(`node ${CLI} hooks generate --platform opencode --deep`, {
        encoding: "utf-8",
      });

      expect(output).toContain("import type { Plugin }");
      expect(output).toContain("CorgiSpecDeep");
      expect(output).toContain('runHook("session-start"');
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
      expect(output).toContain('runHook("pre-write"');
      expect(output).toContain('runHook("pre-bash"');
    });

    it("passes session stdin through loop-check and surfaces its process result", () => {
      const output = execSync(`node ${CLI} hooks generate --platform opencode`, {
        encoding: "utf-8",
      });

      expect(output).toContain("buildStopPayload(event)");
      expect(output).toContain("session_id: sessionId");
      expect(output).toContain('const loopResult = runHook("loop-check"');
      expect(output).toContain('loopDecision.decision === "block"');
      expect(output).toContain("result.stdout");
      expect(output).toContain("result.stderr");
      expect(output).toContain("result.status !== 0");
    });

    it("executes the generated OpenCode idle hook with exact session and process passthrough", () => {
      const fakeBin = resolve(tempDir, "opencode-bin");
      const fakeCorgispec = resolve(fakeBin, "corgispec");
      const pluginPath = resolve(tempDir, "corgispec-deep.mjs");
      const harnessPath = resolve(tempDir, "run-opencode-hook.mjs");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(fakeCorgispec, `#!/usr/bin/env node
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  if (process.argv.at(-1) === "loop-check") {
    if (process.env.FAKE_LOOP_BLOCK === "1") {
      process.stdout.write(JSON.stringify({
        decision: "block",
        reason: "canonical loop is active",
        received: JSON.parse(input),
      }));
      process.stderr.write("OPENCODE-ERR:" + process.argv.slice(2).join(" "));
      return;
    }
    process.stdout.write("OPENCODE-OUT:" + input);
    process.stderr.write("OPENCODE-ERR:" + process.argv.slice(2).join(" "));
    process.exitCode = 7;
  }
});
`);
      chmodSync(fakeCorgispec, 0o755);
      const env = { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}` };
      const source = execSync(`node ${CLI} hooks generate --platform opencode`, {
        encoding: "utf8",
        env,
      });
      writeFileSync(pluginPath, transpileModule(source, {
        compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
      }).outputText);
      writeFileSync(harnessPath, `import { CorgiSpecDeep } from ${JSON.stringify(pluginPath)};
const hooks = await CorgiSpecDeep({});
try {
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "opencode-session" } } });
} catch (error) {
  process.exitCode = Number(error?.exitCode ?? 1);
}
`);
      const result = spawnSync(process.execPath, [harnessPath], {
        encoding: "utf8",
        env,
      });
      expect(result.status).toBe(7);
      expect(JSON.parse(result.stdout.replace(/^OPENCODE-OUT:/u, ""))).toMatchObject({
        hook_event_name: "Stop",
        stop_hook_active: false,
        session_id: "opencode-session",
      });
      expect(result.stderr).toBe("OPENCODE-ERR:hook loop-check");

      const blocked = spawnSync(process.execPath, [harnessPath], {
        encoding: "utf8",
        env: { ...env, FAKE_LOOP_BLOCK: "1" },
      });
      expect(blocked.status).toBe(1);
      expect(JSON.parse(blocked.stdout)).toMatchObject({
        decision: "block",
        received: { session_id: "opencode-session" },
      });
      expect(blocked.stderr).toBe("OPENCODE-ERR:hook loop-check");
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
      expect(existsSync(resolve(outputDir, "hooks/corgispec_loop_check.py"))).toBe(true);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_post_compact.py"))).toBe(true);

      const toml = readFileSync(resolve(outputDir, "config.toml"), "utf-8");
      expect(toml).toContain("hooks = true");

      const wrapper = readFileSync(resolve(outputDir, "hooks/corgispec_pre_bash.py"), "utf-8");
      expect(wrapper).toContain("hook");
      expect(wrapper).toContain("pre-bash");
    });

    it("passes hook stdin, stdout, stderr, and exit code through the Python wrapper", () => {
      const fakeBin = resolve(tempDir, "bin");
      const fakeCorgispec = resolve(fakeBin, "corgispec");
      const outputDir = resolve(tempDir, ".codex-pass-through");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(fakeCorgispec, `#!/usr/bin/env node
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  process.stdout.write("OUT:" + input);
  process.stderr.write("ERR:" + process.argv.slice(2).join(" "));
  process.exitCode = 7;
});
`);
      chmodSync(fakeCorgispec, 0o755);
      const env = { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}` };
      execSync(`node ${CLI} hooks generate --platform codex --output ${outputDir}`, {
        encoding: "utf8",
        env,
      });

      const wrapper = resolve(outputDir, "hooks/corgispec_loop_check.py");
      const result = spawnSync("python3", [wrapper], {
        input: '{"session_id":"session-7"}',
        encoding: "utf8",
        env,
      });
      expect(result.status).toBe(7);
      expect(result.stdout).toBe('OUT:{"session_id":"session-7"}');
      expect(result.stderr).toBe("ERR:hook loop-check");
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
