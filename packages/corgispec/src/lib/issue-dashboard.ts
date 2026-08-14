import type { ParsedTaskGroup } from "./task-groups.js";
import type { RunStateV3 } from "./run-contract-v3.js";

export const DASHBOARD_START = "<!-- corgispec:task-dashboard:start -->";
export const DASHBOARD_END = "<!-- corgispec:task-dashboard:end -->";

export class IssueDashboardError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "IssueDashboardError";
  }
}

export interface TrackerDashboardGroupV3 {
  id: string;
  ordinal: number;
  status: "pending" | "in_progress" | "completed" | "invalidated";
  checkpoint: string | null;
}

export interface TrackerDashboardSnapshotV3 {
  runId: string;
  phase: RunStateV3["phase"];
  sourceMarker: string;
  groups: TrackerDashboardGroupV3[];
}

export function renderIssueDashboard(groups: ParsedTaskGroup[]): string {
  const totalTasks = groups.reduce((total, group) => total + group.totalTasks, 0);
  const completedTasks = groups.reduce((total, group) => total + group.completedTasks, 0);
  const completedGroups = groups.filter((group) => group.status === "done").length;
  const rows = groups.map((group) =>
    `| ${group.number} | ${escapeCell(group.name)} | ${group.status.replace("_", "-")} | ${group.completedTasks}/${group.totalTasks} |`,
  );
  const tasks = groups.flatMap((group) => [
    `\n### Group ${group.number}: ${group.name}`,
    ...group.tasks.map((task) => `- [${task.done ? "x" : " "}] ${task.id} ${task.description}`),
  ]);
  return [
    DASHBOARD_START,
    "## Task Dashboard",
    "",
    `${completedTasks}/${totalTasks} tasks complete · ${completedGroups}/${groups.length} groups approved`,
    "",
    "| Group | Name | Status | Tasks |",
    "|---:|---|---|---:|",
    ...rows,
    ...tasks,
    DASHBOARD_END,
  ].join("\n");
}

export function mergeIssueDashboard(body: string, dashboard: string): string {
  const starts = indexesOf(body, DASHBOARD_START);
  const ends = indexesOf(body, DASHBOARD_END);
  if (starts.length === 0 && ends.length === 0) {
    return `${body.trimEnd()}\n\n${dashboard}\n`;
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0]! < starts[0]!) {
    throw new IssueDashboardError(
      "Issue must contain zero or one ordered managed dashboard marker pair",
      "ISSUE_DASHBOARD_MARKERS_INVALID",
    );
  }
  const before = body.slice(0, starts[0]);
  const after = body.slice(ends[0]! + DASHBOARD_END.length);
  return `${before}${dashboard}${after}`;
}

export function trackerDashboardSnapshotV3(state: RunStateV3): TrackerDashboardSnapshotV3 {
  return {
    runId: state.runId,
    phase: state.phase,
    sourceMarker: state.contract.kind === "rfc-slice"
      ? `<!-- corgispec:feature:v1 key=${state.contract.tracker.idempotencyKey} delivery=${state.contract.deliveryRef} -->`
      : `<!-- corgispec:maintenance:v1 key=${state.contract.tracker.idempotencyKey} change=${state.changeName} -->`,
    groups: Object.values(state.groups)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((group) => ({
        id: group.id,
        ordinal: group.ordinal,
        status: group.status,
        checkpoint: group.trackerCheckpoint,
      })),
  };
}

/** Update only the managed dashboard region from canonical Run Contract state. */
export function updateIssueDashboardFromRun(
  body: string,
  snapshot: TrackerDashboardSnapshotV3,
): string {
  const sourceBody = ensureSourceMarker(body, snapshot.sourceMarker);
  const starts = indexesOf(sourceBody, DASHBOARD_START);
  const ends = indexesOf(sourceBody, DASHBOARD_END);
  if (starts.length !== 1 || ends.length !== 1 || ends[0]! < starts[0]!) {
    throw new IssueDashboardError(
      "Run tracker synchronization requires one ordered managed dashboard marker pair",
      "ISSUE_DASHBOARD_MARKERS_INVALID",
    );
  }
  const start = starts[0]!;
  const end = ends[0]! + DASHBOARD_END.length;
  const groups = new Map(snapshot.groups.map((group) => [group.ordinal, group]));
  const seenRows = new Set<number>();
  let currentGroup: TrackerDashboardGroupV3 | null = null;
  let totalTasks = 0;
  let completedTasks = 0;
  const taskCounts = new Map<number, number>();
  let lines = ensureDashboardGroups(
    sourceBody.slice(start, end).split(/\r?\n/u),
    snapshot.groups,
  )
    .filter((line) => !/^<!-- corgispec:checkpoint:v3\b.*-->$/u.test(line.trim()))
    .map((line) => {
      const row = line.match(/^(\|\s*(\d+)\s*\|.*?\|\s*)(?:pending|in[_-]progress|review|done|blocked)(\s*\|\s*\d+\/\d+\s*\|)$/iu);
      if (row) {
        const ordinal = Number(row[2]);
        const group = groups.get(ordinal);
        if (!group) {
          throw new IssueDashboardError(
            `Issue dashboard contains unknown Task Group ${ordinal}`,
            "ISSUE_DASHBOARD_GROUP_MISMATCH",
          );
        }
        seenRows.add(ordinal);
        return `${row[1]}${dashboardStatus(group.status)}${row[3]}`;
      }
      const heading = line.match(/^###\s+Group\s+(\d+):/iu);
      if (heading) currentGroup = groups.get(Number(heading[1])) ?? null;
      const task = line.match(/^(\s*-\s+\[)[ xX](\]\s+.*)$/u);
      if (task && currentGroup) {
        totalTasks += 1;
        taskCounts.set(currentGroup.ordinal, (taskCounts.get(currentGroup.ordinal) ?? 0) + 1);
        const done = currentGroup.status === "completed";
        if (done) completedTasks += 1;
        return `${task[1]}${done ? "x" : " "}${task[2]}`;
      }
      return line;
    });
  lines = lines.map((line) => {
    const row = line.match(/^(\|\s*(\d+)\s*\|.*?\|\s*(?:pending|in-progress|blocked|done)\s*\|\s*)\d+\/\d+(\s*\|)$/iu);
    if (!row) return line;
    const ordinal = Number(row[2]);
    const total = taskCounts.get(ordinal) ?? 0;
    const completed = groups.get(ordinal)?.status === "completed" ? total : 0;
    return `${row[1]}${completed}/${total}${row[3]}`;
  });
  const missing = snapshot.groups.filter((group) => !seenRows.has(group.ordinal));
  if (missing.length > 0) {
    throw new IssueDashboardError(
      `Issue dashboard is missing Task Group rows: ${missing.map((group) => group.ordinal).join(", ")}`,
      "ISSUE_DASHBOARD_GROUP_MISMATCH",
    );
  }
  const completedGroups = snapshot.groups.filter((group) => group.status === "completed").length;
  const summaryIndex = lines.findIndex((line) => /\d+\/\d+ tasks complete · \d+\/\d+ groups approved/u.test(line));
  if (summaryIndex < 0) {
    throw new IssueDashboardError("Issue dashboard progress summary is missing", "ISSUE_DASHBOARD_INVALID");
  }
  lines[summaryIndex] = `${completedTasks}/${totalTasks} tasks complete · ${completedGroups}/${snapshot.groups.length} groups approved`;
  const endIndex = lines.lastIndexOf(DASHBOARD_END);
  lines.splice(endIndex, 0, ...snapshot.groups.flatMap((group) =>
    group.checkpoint ? [group.checkpoint] : []));
  return `${sourceBody.slice(0, start)}${lines.join("\n")}${sourceBody.slice(end)}`;
}

function ensureDashboardGroups(
  lines: string[],
  groups: TrackerDashboardGroupV3[],
): string[] {
  const existing = new Set(lines.flatMap((line) => {
    const row = line.match(/^\|\s*(\d+)\s*\|/u);
    return row ? [Number(row[1])] : [];
  }));
  const missing = groups.filter((group) => !existing.has(group.ordinal));
  if (missing.length === 0) return lines;
  const rowIndexes = lines.flatMap((line, index) => /^\|\s*\d+\s*\|/u.test(line) ? [index] : []);
  if (rowIndexes.length === 0) {
    throw new IssueDashboardError(
      "Issue dashboard Task Group table is missing",
      "ISSUE_DASHBOARD_INVALID",
    );
  }
  const next = [...lines];
  const insertAt = rowIndexes.at(-1)! + 1;
  next.splice(insertAt, 0, ...missing.map((group) =>
    `| ${group.ordinal} | Repair Task Group ${group.id} | ${dashboardStatus(group.status)} | 0/0 |`
  ));
  const endIndex = next.lastIndexOf(DASHBOARD_END);
  next.splice(endIndex, 0, ...missing.flatMap((group) => [
    "",
    `### Group ${group.ordinal}: Repair Task Group ${group.id}`,
  ]));
  return next;
}

function ensureSourceMarker(body: string, expected: string): string {
  if (body.includes(expected)) return body;
  const parsed = expected.match(/^<!-- corgispec:(feature|maintenance):v1 key=([^ ]+) (delivery|change)=([^ ]+) -->$/u);
  if (!parsed) {
    throw new IssueDashboardError("Run source marker is invalid", "ISSUE_SOURCE_MARKER_INVALID");
  }
  const [, kind, , field, value] = parsed;
  const markerPattern = new RegExp(
    `<!-- corgispec:${kind}:v1 key=[^ ]+ ${field}=${escapeRegExp(value!)} -->`,
    "gu",
  );
  if (markerPattern.test(body)) {
    throw new IssueDashboardError(
      `Issue contains a different source marker for '${value}'`,
      "ISSUE_SOURCE_MARKER_DRIFT",
    );
  }
  return `${expected}\n${body}`;
}

function indexesOf(value: string, search: string): number[] {
  const indexes: number[] = [];
  let offset = 0;
  while (offset <= value.length) {
    const index = value.indexOf(search, offset);
    if (index < 0) break;
    indexes.push(index);
    offset = index + search.length;
  }
  return indexes;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function dashboardStatus(status: TrackerDashboardGroupV3["status"]): string {
  if (status === "in_progress") return "in-progress";
  if (status === "completed") return "done";
  if (status === "invalidated") return "blocked";
  return "pending";
}
