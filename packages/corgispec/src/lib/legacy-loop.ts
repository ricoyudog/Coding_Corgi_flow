import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface LegacyLoopStateSummary {
  path: string;
  platform: "claude" | "opencode";
  changeName: string;
  sessionId: string | null;
  active: boolean;
}

export interface LegacyLoopInspection {
  runs: LegacyLoopStateSummary[];
  corruptPaths: string[];
  unsupportedPaths: string[];
}

/** Inspect only the named change; never silently treats corrupt state as inert. */
export function inspectLegacyLoop(
  projectRoot: string,
  changeName: string,
): LegacyLoopInspection {
  const result: LegacyLoopInspection = {
    runs: [],
    corruptPaths: [],
    unsupportedPaths: [],
  };

  for (const platform of ["claude", "opencode"] as const) {
    const path = resolve(
      projectRoot,
      `.${platform}`,
      "corgi-loop",
      changeName,
      "state.json",
    );
    if (!existsSync(path)) continue;

    let value: unknown;
    try {
      value = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      result.corruptPaths.push(path);
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      result.corruptPaths.push(path);
      continue;
    }
    const state = value as Record<string, unknown>;
    if (state.schemaVersion !== undefined && state.schemaVersion !== 1) {
      result.unsupportedPaths.push(path);
      continue;
    }
    if (state.changeName !== changeName || typeof state.active !== "boolean") {
      result.corruptPaths.push(path);
      continue;
    }
    result.runs.push({
      path,
      platform,
      changeName,
      sessionId: typeof state.sessionId === "string" ? state.sessionId : null,
      active: state.active,
    });
  }

  return result;
}
