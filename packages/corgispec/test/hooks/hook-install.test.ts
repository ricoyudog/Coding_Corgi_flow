import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  applyHookMigrationPlan,
  buildOpenCodeDeepPlugin,
  inspectHookInstallations,
  planHookMigration,
} from "../../src/lib/hook-install.js";

describe("managed hook migration", () => {
  let root: string;
  const cliEntry = "/opt/corgispec/dist/corgispec.js";

  beforeEach(() => {
    root = resolve(
      tmpdir(),
      `corgispec-hook-install-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("leaves a hookless project untouched and reports each platform", () => {
    mkdirSync(resolve(root, ".claude"), { recursive: true });
    writeFileSync(resolve(root, ".claude/settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(git status)"] },
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo keep" }] }],
      },
    }, null, 2));
    mkdirSync(resolve(root, ".codex"), { recursive: true });
    writeFileSync(resolve(root, ".codex/config.toml"), "model = \"gpt-5\"\n");

    const result = inspectHookInstallations({ root, cliEntry });

    expect(result.touchedPaths).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.platforms.claude).toMatchObject({ enabled: false, state: "hookless" });
    expect(result.platforms.opencode).toMatchObject({ enabled: false, state: "hookless" });
    expect(result.platforms.codex).toMatchObject({ enabled: false, state: "hookless" });
  });

  it("replaces only Corgi Claude commands and is idempotent", () => {
    const settingsPath = resolve(root, ".claude/settings.json");
    mkdirSync(resolve(root, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      permissions: { allow: ["Read", "Bash(git status)"] },
      custom: { nested: true },
      hooks: {
        Notification: [{ hooks: [{ type: "command", command: "notify-send done" }] }],
        PreToolUse: [{
          matcher: "Edit|Write",
          hooks: [
            { type: "command", command: "corgispec hook pre-write", timeout: 15 },
            { type: "command", command: "echo keep-pre-tool" },
          ],
        }],
        Stop: [{ hooks: [{ type: "command", command: '"/usr/bin/corgispec" hook stop-check' }] }],
      },
    }, null, 2));

    const plan = planHookMigration({ root, platforms: ["claude"], binaryPath: "npx corgispec" });
    expect(plan.platforms.claude).toMatchObject({ enabled: true, state: "stale" });
    expect(plan.platforms.claude.ownedPaths).toEqual([settingsPath]);
    expect(plan.actions).toHaveLength(1);

    applyHookMigrationPlan(plan);

    const migrated = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(migrated.permissions).toEqual({ allow: ["Read", "Bash(git status)"] });
    expect(migrated.custom).toEqual({ nested: true });
    expect(JSON.stringify(migrated)).toContain("notify-send done");
    expect(JSON.stringify(migrated)).toContain("echo keep-pre-tool");
    expect(JSON.stringify(migrated)).not.toContain("hook pre-write");
    expect(JSON.stringify(migrated)).not.toContain("hook stop-check");
    expect(JSON.stringify(migrated)).toContain("hook loop-check");

    const second = planHookMigration({ root, platforms: ["claude"], binaryPath: "npx corgispec" });
    expect(second.platforms.claude.state).toBe("current");
    expect(second.actions).toEqual([]);
  });

  it("reports malformed Claude settings as a conflict without writing", () => {
    const settingsPath = resolve(root, ".claude/settings.json");
    mkdirSync(resolve(root, ".claude"), { recursive: true });
    writeFileSync(settingsPath, "{ not-json");

    const plan = planHookMigration({ root, platforms: ["claude"] });

    expect(plan.platforms.claude.state).toBe("conflict");
    expect(plan.conflicts[0]?.reason).toContain("Malformed Claude settings JSON");
    expect(plan.actions).toEqual([]);
    expect(() => applyHookMigrationPlan(plan)).toThrow(/conflict/u);
    expect(readFileSync(settingsPath, "utf8")).toBe("{ not-json");
  });

  it("canonicalizes generated OpenCode aliases and removes only signed duplicates", () => {
    const pluginDir = resolve(root, ".opencode/plugins");
    const canonicalPath = resolve(pluginDir, "corgispec-deep.ts");
    const aliasPath = resolve(pluginDir, "corgispec.ts");
    const secondAliasPath = resolve(pluginDir, "corgispec-hooks.ts");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(aliasPath, buildOpenCodeDeepPlugin("/old/cli.js"));
    writeFileSync(secondAliasPath, buildOpenCodeDeepPlugin("/older/cli.js"));

    const plan = planHookMigration({ root, platforms: ["opencode"], cliEntry });

    expect(plan.platforms.opencode).toMatchObject({ enabled: true, state: "stale" });
    expect(plan.platforms.opencode.ownedPaths).toEqual([canonicalPath]);
    expect(plan.actions.map((action) => [action.kind, action.path])).toEqual([
      ["write", canonicalPath],
      ["remove", aliasPath],
      ["remove", secondAliasPath],
    ]);
    applyHookMigrationPlan(plan);
    expect(readFileSync(canonicalPath, "utf8")).toBe(buildOpenCodeDeepPlugin(cliEntry));
    expect(existsSync(aliasPath)).toBe(false);
    expect(existsSync(secondAliasPath)).toBe(false);
    expect(planHookMigration({ root, platforms: ["opencode"], cliEntry }).actions).toEqual([]);
  });

  it("does not overwrite an ambiguous OpenCode plugin", () => {
    const pluginPath = resolve(root, ".opencode/plugins/corgispec-deep.ts");
    mkdirSync(resolve(root, ".opencode/plugins"), { recursive: true });
    writeFileSync(pluginPath, "export const userPlugin = () => ({ custom: true });\n");

    const plan = planHookMigration({ root, platforms: ["opencode"], cliEntry });

    expect(plan.platforms.opencode.state).toBe("conflict");
    expect(plan.conflicts[0]).toMatchObject({ path: pluginPath, status: "locally-modified" });
    expect(plan.actions).toEqual([]);
  });

  it("migrates Codex JSON/TOML/wrappers while preserving unrelated text", () => {
    const codexDir = resolve(root, ".codex");
    const hooksDir = resolve(codexDir, "hooks");
    const configPath = resolve(codexDir, "config.toml");
    const legacyPath = resolve(codexDir, "hooks.json");
    mkdirSync(hooksDir, { recursive: true });
    const customToml = [
      'model = "gpt-5"',
      "",
      "[features]",
      "hooks = false",
      "custom_feature = true",
      "",
      "[mcp_servers.demo]",
      'command = "demo-mcp"',
      "",
      "[[hooks.Stop]]",
      "",
      "[[hooks.Stop.hooks]]",
      'type = "command"',
      'command = "echo keep-non-corgi"',
      "timeout = 3",
      "",
      "# CorgiSpec: pre-write",
      "[[hooks.PreToolUse]]",
      'matcher = "^(Edit|Write)$"',
      "",
      "[[hooks.PreToolUse.hooks]]",
      'type = "command"',
      `command = 'node "\${HOME}/.codex/hooks/corgispec_pre_write.cjs"'`,
      "timeout = 15",
      "",
      "[approval]",
      'policy = "never"',
      "",
    ].join("\n");
    writeFileSync(configPath, customToml);
    writeFileSync(legacyPath, JSON.stringify({
      hooks: {
        Stop: [{ hooks: [
          { type: "command", command: "npx corgispec hook stop-check" },
          { type: "command", command: "echo keep-json" },
        ] }],
      },
    }, null, 2));
    const oldNodeWrapper = `const { spawnSync } = require("node:child_process");\nspawnSync(process.execPath, ["/old/cli.js", "hook", "pre-write"]);\n`;
    const oldPythonWrapper = `\"\"\"CorgiSpec hook: stop-check\"\"\"\nimport subprocess\nsubprocess.run(["corgispec", "hook", "stop-check"])\n`;
    const preWritePath = resolve(hooksDir, "corgispec_pre_write.cjs");
    const stopCheckPath = resolve(hooksDir, "corgispec_stop_check.py");
    writeFileSync(preWritePath, oldNodeWrapper);
    writeFileSync(stopCheckPath, oldPythonWrapper);

    const plan = planHookMigration({ root, platforms: ["codex"], cliEntry });

    expect(plan.platforms.codex).toMatchObject({ enabled: true, state: "stale" });
    expect(plan.actions.some((action) => action.path === legacyPath && action.kind === "write")).toBe(true);
    expect(plan.actions.some((action) => action.path === preWritePath && action.kind === "remove")).toBe(true);
    expect(plan.actions.some((action) => action.path === stopCheckPath && action.kind === "remove")).toBe(true);
    applyHookMigrationPlan(plan);

    const toml = readFileSync(configPath, "utf8");
    expect(toml).toContain('model = "gpt-5"');
    expect(toml).toContain("custom_feature = true");
    expect(toml).toContain("[mcp_servers.demo]");
    expect(toml).toContain('command = "echo keep-non-corgi"');
    expect(toml).toContain("[approval]");
    expect(toml).toContain("hooks = true");
    expect(toml).not.toContain("corgispec_pre_write");
    expect(toml).not.toContain("corgispec_stop_check");
    expect(toml).toContain("corgispec_loop_check.cjs");
    expect(readFileSync(legacyPath, "utf8")).toContain("echo keep-json");
    expect(readFileSync(legacyPath, "utf8")).not.toContain("corgispec hook");
    expect(existsSync(preWritePath)).toBe(false);
    expect(existsSync(stopCheckPath)).toBe(false);
    expect(existsSync(resolve(hooksDir, "corgispec_pre_bash.cjs"))).toBe(true);
    expect(planHookMigration({ root, platforms: ["codex"], cliEntry }).actions).toEqual([]);
  });

  it("reports malformed legacy Codex JSON and malformed hook TOML without mutation", () => {
    const codexDir = resolve(root, ".codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(resolve(codexDir, "hooks.json"), "{ bad-json");
    writeFileSync(resolve(codexDir, "config.toml"), "[[hooks.Stop]\ncommand = 'corgispec hook stop-check'\n");

    const plan = planHookMigration({ root, platforms: ["codex"], cliEntry });

    expect(plan.platforms.codex.state).toBe("conflict");
    expect(plan.actions).toEqual([]);
    expect(plan.conflicts.some((conflict) => conflict.reason.includes("Malformed Codex hooks TOML"))).toBe(true);
  });

  it("refuses to apply when a hook path changes after preflight", () => {
    const pluginPath = resolve(root, ".opencode/plugins/corgispec-deep.ts");
    mkdirSync(resolve(root, ".opencode/plugins"), { recursive: true });
    writeFileSync(pluginPath, buildOpenCodeDeepPlugin("/old/cli.js"));
    const plan = planHookMigration({ root, platforms: ["opencode"], cliEntry });
    writeFileSync(pluginPath, buildOpenCodeDeepPlugin("/changed/after-preflight.js"));

    expect(() => applyHookMigrationPlan(plan)).toThrow(/changed after preflight/u);
    expect(readFileSync(pluginPath, "utf8")).toContain("/changed/after-preflight.js");
  });
});
