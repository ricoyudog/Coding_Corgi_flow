import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
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
      expect(stopCommands.some((command: string) => command.includes("hook stop-check"))).toBe(false);
      const preToolCommands = parsed.hooks.PreToolUse.flatMap((entry: any) =>
        entry.hooks.map((hook: any) => hook.command)
      );
      expect(preToolCommands.some((command: string) => command.includes("hook pre-write"))).toBe(false);
      expect(preToolCommands.some((command: string) => command.includes("hook pre-bash"))).toBe(true);
    });

    it("passes Stop hook stdin, stdout, stderr, session, and exit code through Claude command config", () => {
      const fakeBin = resolve(tempDir, "claude-bin");
      const fakeEntry = resolve(fakeBin, "fake-corgispec.cjs");
      const fakeCorgispec = resolve(
        fakeBin,
        process.platform === "win32" ? "corgispec.cmd" : "corgispec",
      );
      mkdirSync(fakeBin, { recursive: true });
      const source = `#!/usr/bin/env node
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  process.stdout.write("CLAUDE-OUT:" + input);
  process.stderr.write("CLAUDE-ERR:" + process.argv.slice(2).join(" "));
  process.exitCode = 7;
});
`;
      if (process.platform === "win32") {
        writeFileSync(fakeEntry, source);
        writeFileSync(
          fakeCorgispec,
          `@echo off\r\n"${process.execPath}" "${fakeEntry}" %*\r\n`,
        );
      } else {
        writeFileSync(fakeCorgispec, source);
        chmodSync(fakeCorgispec, 0o755);
      }
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

    it("plugin output includes session-scoped write enforcement and global Bash protection", () => {
      const output = execSync(`node ${CLI} hooks generate --platform opencode`, {
        encoding: "utf-8",
      });

      expect(output).toContain("tool.execute.before");
      expect(output).toContain('"chat.message"');
      expect(output).toContain('"command.execute.before"');
      expect(output).toContain("activationBySession");
      expect(output).toContain('runHook("pre-write"');
      expect(output).toContain('runHook("pre-bash"');
    });

    it("captures Node for hook execution and routes idle failures through promptAsync", () => {
      const output = execSync(`node ${CLI} hooks generate --platform opencode`, {
        encoding: "utf-8",
      });

      expect(output).toContain("buildStopPayload(event)");
      expect(output).toContain("session_id: sessionId");
      expect(output).toContain('const loopResult = runHook("loop-check"');
      expect(output).toContain('loopDecision.decision === "block"');
      expect(output).not.toContain('runHook("sync-tracker"');
      expect(output).not.toContain("glab issue");
      expect(output).not.toContain("gh issue");
      expect(output).toContain("result.stdout");
      expect(output).toContain("result.stderr");
      expect(output).toContain("result.status !== 0");
      expect(output).toContain("client.session.promptAsync");
      expect(output).toContain(`const NODE_ENTRY = ${JSON.stringify(process.execPath)};`);
      expect(output).toContain("spawnSync(\n    NODE_ENTRY");
      expect(output).not.toContain("spawnSync(\n    process.execPath");
      expect(output).not.toMatch(/BINARY_COMMAND|\.cmd[^\n]*hook/iu);
      expect(output).not.toContain("shell: true");
    });

    it("isolates command and skill activation by session and resets it on each prompt", () => {
      const fakeBin = resolve(tempDir, "opencode-activation-bin");
      const fakeCorgispec = resolve(fakeBin, "fake-corgispec.cjs");
      const pluginPath = resolve(tempDir, "corgispec-activation.mjs");
      const harnessPath = resolve(tempDir, "run-opencode-activation.mjs");
      const logPath = resolve(tempDir, "hook-activation.jsonl");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(fakeCorgispec, `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const subcommand = process.argv.at(-1);
  appendFileSync(process.env.FAKE_HOOK_LOG, JSON.stringify({ subcommand, input }) + "\\n");
  if (subcommand === "loop-check") {
    process.stdout.write(JSON.stringify({ decision: "proceed" }));
  }
});
`);
      chmodSync(fakeCorgispec, 0o755);
      const generatedSource = execSync(`node ${CLI} hooks generate --platform opencode`, {
        encoding: "utf8",
      });
      const source = generatedSource.replace(
        /^const CLI_ENTRY = .*;$/mu,
        `const CLI_ENTRY = ${JSON.stringify(fakeCorgispec)};`,
      );
      writeFileSync(pluginPath, transpileModule(source, {
        compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
      }).outputText);
      writeFileSync(harnessPath, `import { CorgiSpecDeep } from ${JSON.stringify(pathToFileURL(pluginPath).href)};
const hooks = await CorgiSpecDeep({
  directory: "/workspace",
  client: { session: { promptAsync: async () => ({ data: undefined, error: undefined }) } },
});
const message = (sessionID) => hooks["chat.message"](
  { sessionID },
  { message: {}, parts: [] },
);
const command = (sessionID, name) => hooks["command.execute.before"](
  { command: name, sessionID, arguments: "" },
  { parts: [] },
);
const tool = (sessionID, name, args = {}) => hooks["tool.execute.before"](
  { tool: name, sessionID, callID: sessionID + "-call" },
  { args },
);
const idle = (sessionID) => hooks.event({
  event: { type: "session.idle", properties: { sessionID } },
});

for (const name of ${JSON.stringify([
  "corgi-apply",
  "corgi-propose",
  "corgi-update",
  "corgi-converge",
  "corgi-archive",
  "corgi-human-qa",
])}) {
  const sessionID = "command-" + name;
  await message(sessionID);
  await command(sessionID, name);
  await tool(sessionID, "write", { filePath: "/workspace/command.ts" });
  await idle(sessionID);
}

for (const name of ${JSON.stringify([
  "corgispec-apply",
  "corgispec-propose",
  "corgispec-gh-propose",
  "corgispec-update",
  "corgispec-converge",
  "corgispec-archive-change",
  "corgispec-gh-archive",
  "corgispec-human-qa",
])}) {
  const sessionID = "skill-" + name;
  await message(sessionID);
  await tool(sessionID, "skill", { name });
  await tool(sessionID, "edit", { filePath: "/workspace/skill.ts" });
  await idle(sessionID);
}

await message("normal-session");
await tool("normal-session", "write", { filePath: "/workspace/normal.ts" });
await idle("normal-session");

await message("reset-session");
await tool("reset-session", "skill", { name: "corgispec-propose" });
await tool("reset-session", "write", { filePath: "/workspace/active.ts" });
await message("reset-session");
await tool("reset-session", "write", { filePath: "/workspace/reset.ts" });
await idle("reset-session");

await message("concurrent-a");
await message("concurrent-b");
await tool("concurrent-a", "skill", { name: "corgispec-propose" });
await command("concurrent-b", "/corgi-apply");
await tool("concurrent-a", "write", { filePath: "/workspace/a-before-reset.ts" });
await tool("concurrent-b", "write", { filePath: "/workspace/b-before-reset.ts" });
await message("concurrent-a");
await tool("concurrent-a", "write", { filePath: "/workspace/a-after-reset.ts" });
await tool("concurrent-b", "write", { filePath: "/workspace/b-after-reset.ts" });
await idle("concurrent-a");
await idle("concurrent-b");
`);

      const result = spawnSync(process.execPath, [harnessPath], {
        encoding: "utf8",
        env: { ...process.env, FAKE_HOOK_LOG: logPath },
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      const records = readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { subcommand: string; input: string });
      const preWrites = records.filter((record) => record.subcommand === "pre-write");
      const stopChecks = records.filter((record) => record.subcommand === "stop-check");
      const loopChecks = records.filter((record) => record.subcommand === "loop-check");
      const writtenPaths = preWrites.map((record) =>
        JSON.parse(record.input).tool_input.file_path as string
      );

      expect(preWrites).toHaveLength(18);
      expect(writtenPaths).not.toContain("/workspace/normal.ts");
      expect(writtenPaths).not.toContain("/workspace/reset.ts");
      expect(writtenPaths).not.toContain("/workspace/a-after-reset.ts");
      expect(writtenPaths).toContain("/workspace/b-after-reset.ts");
      expect(stopChecks).toHaveLength(0);
      expect(loopChecks).toHaveLength(18);
    });

    it("re-enters OpenCode from a fire-and-forget idle event while preserving hook output", () => {
      const fakeBin = resolve(tempDir, "opencode-bin");
      const fakeCorgispec = resolve(fakeBin, "fake-corgispec.cjs");
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
    if (process.env.FAKE_LOOP_ERROR === "1") {
      process.stdout.write("OPENCODE-OUT:" + input);
      process.stderr.write("OPENCODE-ERR:" + process.argv.slice(2).join(" "));
      process.exitCode = 7;
      return;
    }
    process.stdout.write(JSON.stringify({ decision: "proceed", received: JSON.parse(input) }));
  }
});
`);
      chmodSync(fakeCorgispec, 0o755);
      const env = { ...process.env };
      const generatedSource = execSync(`node ${CLI} hooks generate --platform opencode`, {
        encoding: "utf8",
        env,
      });
      const source = generatedSource.replace(
        /^const CLI_ENTRY = .*;$/mu,
        `const CLI_ENTRY = ${JSON.stringify(fakeCorgispec)};`,
      );
      expect(source).not.toBe(generatedSource);
      writeFileSync(pluginPath, transpileModule(source, {
        compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
      }).outputText);
      writeFileSync(harnessPath, `import { CorgiSpecDeep } from ${JSON.stringify(pathToFileURL(pluginPath).href)};
const prompts = [];
const hooks = await CorgiSpecDeep({
  directory: "/workspace",
  client: {
    session: {
      promptAsync: async (options) => {
        prompts.push(options);
        return { data: undefined, error: undefined };
      },
    },
  },
});
Object.defineProperty(process, "execPath", {
  configurable: true,
  value: "/definitely-not-the-node-runtime/opencode.exe",
});
await hooks["command.execute.before"](
  { command: "corgi-apply", sessionID: "opencode-session", arguments: "" },
  { parts: [] },
);
void hooks.event({ event: { type: "session.idle", properties: { sessionID: "opencode-session" } } });
await new Promise((settle) => setTimeout(settle, 0));
process.stdout.write("\\nPROMPTS:" + JSON.stringify(prompts));
`);
      const parseHarness = (stdout: string) => {
        const marker = "\nPROMPTS:";
        const index = stdout.lastIndexOf(marker);
        expect(index).toBeGreaterThanOrEqual(0);
        return {
          hookOutput: stdout.slice(0, index),
          prompts: JSON.parse(stdout.slice(index + marker.length)) as any[],
        };
      };
      const result = spawnSync(process.execPath, [harnessPath], {
        encoding: "utf8",
        env,
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      const proceeded = parseHarness(result.stdout);
      expect(JSON.parse(proceeded.hookOutput)).toMatchObject({
        decision: "proceed",
        received: {
          hook_event_name: "Stop",
          stop_hook_active: false,
          session_id: "opencode-session",
        },
      });
      expect(proceeded.prompts).toEqual([]);
      expect(result.stderr).toBe("");

      const errored = spawnSync(process.execPath, [harnessPath], {
        encoding: "utf8",
        env: { ...env, FAKE_LOOP_ERROR: "1" },
      });
      expect(errored.status).toBe(0);
      const loopError = parseHarness(errored.stdout);
      expect(JSON.parse(loopError.hookOutput.replace(/^OPENCODE-OUT:/u, ""))).toMatchObject({
        hook_event_name: "Stop",
        stop_hook_active: false,
        session_id: "opencode-session",
      });
      expect(loopError.prompts[0]).toMatchObject({
        path: { id: "opencode-session" },
        query: { directory: "/workspace" },
        body: { parts: [{ type: "text", text: expect.stringContaining("Exit code: 7") }] },
      });
      expect(errored.stderr).toBe("OPENCODE-ERR:hook loop-check");

      const blocked = spawnSync(process.execPath, [harnessPath], {
        encoding: "utf8",
        env: { ...env, FAKE_LOOP_BLOCK: "1" },
      });
      expect(blocked.status).toBe(0);
      const loopBlocked = parseHarness(blocked.stdout);
      expect(JSON.parse(loopBlocked.hookOutput)).toMatchObject({
        decision: "block",
        received: { session_id: "opencode-session" },
      });
      expect(loopBlocked.prompts[0]).toMatchObject({
        path: { id: "opencode-session" },
        body: { parts: [{ text: expect.stringContaining("Run Contract v2 is still active") }] },
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
    it("outputs TOML and Node wrappers to stdout without an undeclared Python dependency", () => {
      const output = execSync(`node ${CLI} hooks generate --platform codex`, {
        encoding: "utf-8",
      });

      expect(output).toContain("[features]");
      expect(output).toContain("hooks = true");
      expect(output).toContain("[[hooks.");
      expect(output).toContain("#!/usr/bin/env node");
      expect(output).toContain("corgispec_session_start.cjs");
      expect(output).toContain(`commandWindows = 'node `);
      expect(output).toContain("spawnSync(process.execPath");
      expect(output).not.toMatch(/spawnSync\([^\n]*\.cmd/iu);
      expect(output).not.toContain("shell: true");
      expect(output).not.toContain("python3");
    });

    it("writes config.toml and hook scripts to output directory", () => {
      const outputDir = resolve(tempDir, ".codex");

      execSync(
        `node ${CLI} hooks generate --platform codex --output ${outputDir}`,
        { encoding: "utf-8" }
      );

      expect(existsSync(resolve(outputDir, "config.toml"))).toBe(true);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_session_start.cjs"))).toBe(true);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_pre_write.cjs"))).toBe(false);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_pre_bash.cjs"))).toBe(true);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_post_write.cjs"))).toBe(true);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_stop_check.cjs"))).toBe(false);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_loop_check.cjs"))).toBe(true);
      expect(existsSync(resolve(outputDir, "hooks/corgispec_post_compact.cjs"))).toBe(true);

      const toml = readFileSync(resolve(outputDir, "config.toml"), "utf-8");
      expect(toml).toContain("hooks = true");
      expect(toml).not.toContain("pre-write");
      expect(toml).not.toContain("stop-check");

      const wrapper = readFileSync(resolve(outputDir, "hooks/corgispec_pre_bash.cjs"), "utf-8");
      expect(wrapper).toContain("hook");
      expect(wrapper).toContain("pre-bash");
    });

    it("passes hook stdin, stderr, and exit code through a shell-free Node entry", () => {
      const outputDir = resolve(tempDir, ".codex-pass-through");
      execSync(`node ${CLI} hooks generate --platform codex --output ${outputDir}`, {
        encoding: "utf8",
      });
      mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
      writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: spec-driven\n");

      const wrapper = resolve(outputDir, "hooks/corgispec_pre_bash.cjs");
      const result = spawnSync(process.execPath, [wrapper], {
        input: '{"tool_input":{"command":"rm -rf /"}}',
        encoding: "utf8",
        cwd: tempDir,
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Blocked: rm -rf / or equivalent destructive command detected.");

      const allowed = spawnSync(process.execPath, [wrapper], {
        input: '{"tool_input":{"command":"pwd"}}',
        encoding: "utf8",
        cwd: tempDir,
      });
      expect(allowed.status).toBe(0);
      expect(JSON.parse(allowed.stdout)).toEqual({ continue: true });
      expect(allowed.stderr).toBe("");

      const source = readFileSync(wrapper, "utf8");
      expect(source).toContain(
        `spawnSync(process.execPath, [${JSON.stringify(resolve(CLI))}, "hook", "pre-bash"]`,
      );
      expect(source).not.toContain("shell:");
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
