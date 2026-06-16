import { Command } from "commander";
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { isHooksDisabled, findProjectRoot, readStdinJson } from "../../lib/hooks.js";
import { processLoopState } from "../../lib/loop-state.js";
import type { LoopState, VerifyArtifact, ReviewArtifact } from "../../lib/loop-types.js";

export function createHookLoopCheckCommand(): Command {
  const cmd = new Command("loop-check");

  cmd
    .description("Corgi Loop stop hook — orchestrates group-by-group execution")
    .option("--path <dir>", "Working directory", ".")
    .action(async (opts) => {
      // 1. Inert guard: hooks disabled
      if (isHooksDisabled()) {
        process.exit(0);
      }

      // 2. Project root detection
      const cwd = resolve(opts.path);
      const projectRoot = findProjectRoot(cwd);
      if (!projectRoot) {
        process.exit(0);
      }

      // 3. Read stdin (Stop hook input from Claude Code)
      const stdinData = await readStdinJson();
      const input = {
        hook_event_name: "Stop",
        stop_hook_active: stdinData?.stop_hook_active ?? false,
        session_id: stdinData?.session_id ?? "",
      };

      // 4. Discover active loop state (glob-based: .claude/corgi-loop/*/state.json or .opencode/corgi-loop/*/state.json)
      const stateRoots = [".claude/corgi-loop", ".opencode/corgi-loop"];
      let state: LoopState | null = null;
      let statePath = "";

      for (const root of stateRoots) {
        const loopDir = resolve(projectRoot, root);
        if (!existsSync(loopDir)) continue;
        try {
          const entries = readdirSync(loopDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const candidate = resolve(loopDir, entry.name, "state.json");
            if (!existsSync(candidate)) continue;
            const raw = readFileSync(candidate, "utf-8");
            const parsed = JSON.parse(raw);
            if (parsed.active === true) {
              state = parsed as LoopState;
              statePath = candidate;
              break;
            }
          }
        } catch { /* corrupted state, skip */ }
        if (state) break;
      }

      // 5. No active loop → proceed normally
      if (!state) {
        console.log(JSON.stringify({ decision: "proceed" }));
        process.exit(0);
      }

      // 6. Load verify.json and review.json for current group
      const groupDir = resolve(statePath, "..", "groups", String(state.currentGroup));
      let verify: VerifyArtifact | undefined;
      let review: ReviewArtifact | undefined;

      const verifyPath = resolve(groupDir, "verify.json");
      if (existsSync(verifyPath)) {
        try {
          verify = JSON.parse(readFileSync(verifyPath, "utf-8")) as VerifyArtifact;
        } catch { /* malformed, let state machine catch it */ }
      }

      const reviewPath = resolve(groupDir, "review.json");
      if (existsSync(reviewPath)) {
        try {
          review = JSON.parse(readFileSync(reviewPath, "utf-8")) as ReviewArtifact;
        } catch { /* malformed, let state machine catch it */ }
      }

      // 7. Call the state machine
      const wasActive = state.active;
      const result = processLoopState(state, verify!, review!, input);

      // 8. Atomically write state mutations (tmp + rename)
      const stateDir = resolve(statePath, "..");
      const tmpPath = resolve(stateDir, "state.json.tmp");
      writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
      renameSync(tmpPath, statePath);

      // 9. Output decision as JSON
      // Include phase/terminal/reason — consumers (loop orchestration, integration
      // tests, stop-check composition) depend on these fields to distinguish
      // terminal stops from non-terminal blocks and to route on phase.
      const output: Record<string, unknown> = {
        decision: result.decision,
        phase: state.phase,
        terminal: wasActive && !state.active,
      };
      if (result.reason) {
        output.reason = result.reason;
      }
      console.log(JSON.stringify(output));
      process.exit(0);
    });

  return cmd;
}
