export type TaskGroupStatus = "done" | "in_progress" | "pending";

export interface ParsedTask {
  id: string;
  description: string;
  done: boolean;
  line: number;
}

export interface ParsedTaskGroup {
  number: number;
  name: string;
  tasks: ParsedTask[];
  totalTasks: number;
  completedTasks: number;
  status: TaskGroupStatus;
  line: number;
}

export type TaskGroupIssueSeverity = "error" | "warning";

export interface TaskGroupIssue {
  code:
    | "NO_TASK_GROUPS"
    | "DUPLICATE_GROUP_ID"
    | "EMPTY_TASK_GROUP"
    | "DUPLICATE_TASK_ID"
    | "TASK_ID_MISSING"
    | "TASK_OUTSIDE_GROUP"
    | "TASK_GROUP_MISMATCH"
    | "GROUP_SEQUENCE";
  severity: TaskGroupIssueSeverity;
  message: string;
  line?: number;
}

export interface TaskGroupParseResult {
  groups: ParsedTaskGroup[];
  issues: TaskGroupIssue[];
}

const GROUP_HEADING = /^##\s+(\d+)\.\s+(.+?)\s*$/;
const TASK = /^\s*[-*]\s+\[([ xX])\]\s+([0-9]+(?:\.[0-9A-Za-z_-]+)+)\s+(.+?)\s*$/;
const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/;

/**
 * Parse Corgi Task Groups without assuming a particular artifact filename.
 * Diagnostics are returned alongside usable groups so callers can render all
 * readiness failures in one pass.
 */
export function parseTaskGroupsDocument(content: string): TaskGroupParseResult {
  const groups: ParsedTaskGroup[] = [];
  const issues: TaskGroupIssue[] = [];
  const groupIds = new Set<number>();
  const taskIds = new Set<string>();
  let current: ParsedTaskGroup | null = null;

  const finishCurrent = (): void => {
    if (!current) return;
    current.totalTasks = current.tasks.length;
    current.completedTasks = current.tasks.filter((task) => task.done).length;
    current.status =
      current.totalTasks > 0 && current.completedTasks === current.totalTasks
        ? "done"
        : current.completedTasks > 0
          ? "in_progress"
          : "pending";
    if (current.totalTasks === 0) {
      issues.push({
        code: "EMPTY_TASK_GROUP",
        severity: "error",
        message: `Task Group ${current.number} has no numbered checkbox tasks`,
        line: current.line,
      });
    }
    groups.push(current);
    current = null;
  };

  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index] ?? "";
    const heading = line.match(GROUP_HEADING);
    if (heading) {
      finishCurrent();
      const number = Number.parseInt(heading[1]!, 10);
      if (groupIds.has(number)) {
        issues.push({
          code: "DUPLICATE_GROUP_ID",
          severity: "error",
          message: `Task Group ${number} is declared more than once`,
          line: lineNumber,
        });
      }
      groupIds.add(number);
      current = {
        number,
        name: heading[2]!.trim(),
        tasks: [],
        totalTasks: 0,
        completedTasks: 0,
        status: "pending",
        line: lineNumber,
      };
      continue;
    }

    const task = line.match(TASK);
    if (task) {
      if (!current) {
        issues.push({
          code: "TASK_OUTSIDE_GROUP",
          severity: "error",
          message: `Task ${task[2]} is outside a Task Group`,
          line: lineNumber,
        });
        continue;
      }
      const id = task[2]!;
      if (taskIds.has(id)) {
        issues.push({
          code: "DUPLICATE_TASK_ID",
          severity: "error",
          message: `Task id ${id} is declared more than once`,
          line: lineNumber,
        });
      }
      taskIds.add(id);
      if (Number.parseInt(id.split(".")[0]!, 10) !== current.number) {
        issues.push({
          code: "TASK_GROUP_MISMATCH",
          severity: "error",
          message: `Task ${id} does not belong to Task Group ${current.number}`,
          line: lineNumber,
        });
      }
      current.tasks.push({
        id,
        description: task[3]!.trim(),
        done: task[1]!.toLowerCase() === "x",
        line: lineNumber,
      });
      continue;
    }

    if (CHECKBOX.test(line)) {
      issues.push({
        code: "TASK_ID_MISSING",
        severity: "error",
        message: "Checkbox task is missing a stable numbered task id",
        line: lineNumber,
      });
    }
  }
  finishCurrent();

  if (groups.length === 0) {
    issues.push({
      code: "NO_TASK_GROUPS",
      severity: "error",
      message: "No Task Group headings were found",
    });
  } else {
    const ordered = groups.map((group) => group.number);
    const expected = ordered.map((_, index) => index + 1);
    if (ordered.some((number, index) => number !== expected[index])) {
      issues.push({
        code: "GROUP_SEQUENCE",
        severity: "warning",
        message: `Task Group ids should be sequential from 1 (found: ${ordered.join(", ")})`,
      });
    }
  }

  return { groups, issues };
}

export function findNextTaskGroup(
  groups: ParsedTaskGroup[],
): ParsedTaskGroup | null {
  return groups.find((group) => group.status !== "done") ?? null;
}
