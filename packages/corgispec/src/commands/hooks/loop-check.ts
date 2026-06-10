import { Command } from "commander";
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import {
  isHooksDisabled,
  findProjectRoot,
  readStdinJson,
} from "../../lib/hooks.js";
import { evaluateLoopState } from "../../lib/loop-state.js";
import type {
  LoopState,
  VerifyArtifact,
  ReviewArtifact,
} from "../../lib/loop-types.js";

// ─── State Discovery ────────────────────────────────────────────────────

/**
 * Scan both platform directories for an active loop state.
 * Returns the first active LoopState found with its platform dir, or null.
 */
function findActiveState(projectRoot: string): { state: LoopState; platformDir: string } | null {
  const platformDirs = [".claude/corgi-loop", ".opencode/corgi-loop"];

  for (const dir of platformDirs) {
    const loopDir = resolve(projectRoot, dir);
    if (!existsSync(loopDir)) continue;

    try {
      const entries = readdirSync(loopDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const statePath = resolve(loopDir, entry.name, "state.json");
        if (!existsSync(statePath)) continue;

        const raw = readFileSync(statePath, "utf-8");
        const state = JSON.parse(raw) as LoopState;
        if (state.active) {
          return { state, platformDir: dir };
        }
      }
    } catch {
      // Skip malformed directories
      continue;
    }
  }

  return null;
}

// ─── Artifact Reading ───────────────────────────────────────────────────

function readVerifyArtifact(
  projectRoot: string,
  platformDir: string,
  changeName: string,
  currentGroup: number,
): VerifyArtifact | undefined {
  const path = resolve(
    projectRoot,
    platformDir,
    changeName,
    "groups",
    String(currentGroup),
    "verify.json",
  );

  if (!existsSync(path)) return undefined;

  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as VerifyArtifact;
  } catch {
    return undefined;
  }
}

function readReviewArtifact(
  projectRoot: string,
  platformDir: string,
  changeName: string,
  currentGroup: number,
): ReviewArtifact | undefined {
  const path = resolve(
    projectRoot,
    platformDir,
    changeName,
    "groups",
    String(currentGroup),
    "review.json",
  );

  if (!existsSync(path)) return undefined;

  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as ReviewArtifact;
  } catch {
    return undefined;
  }
}

// ─── Atomic Write ───────────────────────────────────────────────────────

function writeStateAtomic(statePath: string, state: LoopState): void {
  const tmpPath = statePath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmpPath, statePath);
}

// ─── Command ────────────────────────────────────────────────────────────

export function createHookLoopCheckCommand(): Command {
  const cmd = new Command("loop-check");

  cmd
    .description("Evaluate Corgi Loop state machine (Loop hook)")
    .option("--path <dir>", "Working directory", ".")
    .action(async (opts) => {
      if (isHooksDisabled()) {
        process.exit(0);
      }

      const cwd = resolve(opts.path);
      const projectRoot = findProjectRoot(cwd);

      if (!projectRoot) {
        process.exit(0);
      }

      await readStdinJson();

      // Discover active loop state across both platform directories
      const found = findActiveState(projectRoot);
      if (!found) {
        process.stdout.write(JSON.stringify({ decision: "proceed" }));
        process.exit(0);
      }

      // Non-null assertion: guard above exits when found is null
      const { state, platformDir } = found!;

      // Read optional artifacts for the current group
      const verifyArtifact = readVerifyArtifact(
        projectRoot,
        platformDir,
        state.changeName,
        state.currentGroup,
      );

      const reviewArtifact = readReviewArtifact(
        projectRoot,
        platformDir,
        state.changeName,
        state.currentGroup,
      );

      // Evaluate the state machine (pure function — no side effects)
      const result = evaluateLoopState(state, verifyArtifact, reviewArtifact);

      // Write mutated state back atomically
      const statePath = resolve(
        projectRoot,
        platformDir,
        state.changeName,
        "state.json",
      );
      writeStateAtomic(statePath, result.state);

      // Output decision to stdout (without the state field)
      const output = {
        decision: result.decision,
        phase: result.phase,
        terminal: result.terminal,
        reason: result.reason,
      };
      process.stdout.write(JSON.stringify(output));

      process.exit(0);
    });

  return cmd;
}
