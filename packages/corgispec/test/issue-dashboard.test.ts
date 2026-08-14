import { describe, expect, it } from "vitest";
import {
  DASHBOARD_START,
  mergeIssueDashboard,
  renderIssueDashboard,
  updateIssueDashboardFromRun,
} from "../src/lib/issue-dashboard.js";

const groups = [{
  number: 1,
  name: "Build export",
  tasks: [{ id: "1.1", description: "ship", done: false, line: 2 }],
  totalTasks: 1,
  completedTasks: 0,
  status: "pending" as const,
  line: 1,
}];

describe("single Issue dashboard", () => {
  it("adds and replaces only the managed marker region", () => {
    const first = mergeIssueDashboard("Human preface\n", renderIssueDashboard(groups));
    expect(first).toContain("Human preface");
    expect(first).toContain(DASHBOARD_START);
    const updated = mergeIssueDashboard(first, renderIssueDashboard([{ ...groups[0]!, status: "done", completedTasks: 1 }]));
    expect(updated.match(/corgispec:task-dashboard:start/g)).toHaveLength(1);
    expect(updated).toContain("1/1 tasks complete");
  });

  it("fails closed for duplicate managed regions", () => {
    const region = renderIssueDashboard(groups);
    expect(() => mergeIssueDashboard(`${region}\n${region}`, region)).toThrowError(
      expect.objectContaining({ code: "ISSUE_DASHBOARD_MARKERS_INVALID" }),
    );
  });

  it("updates group/task progress from Run state without changing human content", () => {
    const body = `Human preface\n\n${renderIssueDashboard(groups)}\n\nHuman suffix`;
    const checkpoint = "<!-- corgispec:checkpoint:v3 run=run-a group=1 key=abc -->";
    const updated = updateIssueDashboardFromRun(body, {
      runId: "run-a",
      phase: "awaiting_verify",
      sourceMarker: "<!-- corgispec:feature:v1 key=new delivery=RFC-0002-export/S-01-export -->",
      groups: [{ id: "1", ordinal: 1, status: "completed", checkpoint }],
    });

    expect(updated).toContain("Human preface");
    expect(updated).toContain("Human suffix");
    expect(updated).toContain("key=new delivery=RFC-0002-export/S-01-export");
    expect(updated).toContain("| 1 | Build export | done | 1/1 |");
    expect(updated).toContain("- [x] 1.1 ship");
    expect(updated).toContain("1/1 tasks complete · 1/1 groups approved");
    expect(updated.match(/corgispec:checkpoint:v3/g)).toHaveLength(1);

    const repeated = updateIssueDashboardFromRun(updated, {
      runId: "run-a",
      phase: "awaiting_verify",
      sourceMarker: "<!-- corgispec:feature:v1 key=new delivery=RFC-0002-export/S-01-export -->",
      groups: [{ id: "1", ordinal: 1, status: "completed", checkpoint }],
    });
    expect(repeated).toBe(updated);
  });

  it("adds an Amendment marker while retaining the original delivery marker", () => {
    const original = "<!-- corgispec:feature:v1 key=old delivery=RFC-0002-export/S-01-export -->";
    const body = `${original}\n\n${renderIssueDashboard(groups)}`;
    const amended = updateIssueDashboardFromRun(body, {
      runId: "run-amendment",
      phase: "applying",
      sourceMarker: "<!-- corgispec:feature:v1 key=new delivery=RFC-0003-amend-export/S-01-export -->",
      groups: [{ id: "1", ordinal: 1, status: "in_progress", checkpoint: null }],
    });

    expect(amended).toContain(original);
    expect(amended).toContain("delivery=RFC-0003-amend-export/S-01-export");
  });

  it("extends the same dashboard for one appended Repair Task Group", () => {
    const body = renderIssueDashboard(groups);
    const repaired = updateIssueDashboardFromRun(body, {
      runId: "run-repair",
      phase: "planning_ready",
      sourceMarker: "<!-- corgispec:feature:v1 key=new delivery=RFC-0003-amend-export/S-01-export -->",
      groups: [
        { id: "1", ordinal: 1, status: "completed", checkpoint: null },
        { id: "2", ordinal: 2, status: "pending", checkpoint: null },
      ],
    });

    expect(repaired).toContain("| 2 | Repair Task Group 2 | pending | 0/0 |");
    expect(repaired).toContain("### Group 2: Repair Task Group 2");
    expect(repaired).toContain("1/2 groups approved");
  });
});
