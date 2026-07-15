import { describe, expect, it } from "vitest";
import { findNextTaskGroup, parseTaskGroupsDocument } from "../src/lib/task-groups.js";

describe("parseTaskGroupsDocument", () => {
  it("parses CRLF, uppercase completion marks and mixed list markers", () => {
    const result = parseTaskGroupsDocument(
      "## 1. First\r\n- [X] 1.1 done\r\n* [ ] 1.2 pending\r\n## 2. Second\r\n- [x] 2.1 done\r\n",
    );

    expect(result.issues).toEqual([]);
    expect(result.groups).toMatchObject([
      { number: 1, totalTasks: 2, completedTasks: 1, status: "in_progress" },
      { number: 2, totalTasks: 1, completedTasks: 1, status: "done" },
    ]);
    expect(findNextTaskGroup(result.groups)?.number).toBe(1);
    expect(findNextTaskGroup(result.groups.filter((group) => group.status === "done"))).toBeNull();
  });

  it("reports structural errors together", () => {
    const result = parseTaskGroupsDocument(
      [
        "- [ ] 1.0 outside",
        "## 1. Empty",
        "## 1. Duplicate",
        "- [ ] task without id",
        "- [ ] 2.1 wrong group",
        "- [ ] 2.1 duplicate id",
      ].join("\n"),
    );

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "TASK_OUTSIDE_GROUP",
        "EMPTY_TASK_GROUP",
        "DUPLICATE_GROUP_ID",
        "TASK_ID_MISSING",
        "TASK_GROUP_MISMATCH",
        "DUPLICATE_TASK_ID",
        "GROUP_SEQUENCE",
      ]),
    );
  });

  it("reports a document with no groups", () => {
    expect(parseTaskGroupsDocument("# Tasks\nNothing yet").issues).toEqual([
      expect.objectContaining({ code: "NO_TASK_GROUPS", severity: "error" }),
    ]);
  });
});
