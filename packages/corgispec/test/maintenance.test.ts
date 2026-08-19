import { describe, expect, it } from "vitest";
import {
  classifyMaintenance,
  validateMaintenanceDiffScope,
} from "../src/lib/maintenance.js";

describe("RFC maintenance exemption", () => {
  it("classifies only one closed maintenance category", () => {
    expect(classifyMaintenance("Correct a documentation typo", [])).toMatchObject({
      category: "docs-only",
      acceptance: [{ id: "MC-001", evidence: "human" }],
    });
  });

  it("requires a contract reference for behavior-restoring bugs", () => {
    expect(() => classifyMaintenance("Fix a regression", [])).toThrowError(
      expect.objectContaining({ code: "MAINTENANCE_CONTRACT_REFERENCE_REQUIRED" }),
    );
    expect(classifyMaintenance("Fix a regression", ["RFC-0001-foundation/AC-001"]))
      .toMatchObject({ category: "contract-bug" });
  });

  it("escalates public behavior or ambiguous scope to an RFC", () => {
    expect(() => classifyMaintenance("Add a new CLI behavior", [])).toThrowError(
      expect.objectContaining({ code: "RFC_REQUIRED" }),
    );
    expect(() => classifyMaintenance("Routine maintenance", [])).toThrowError(
      expect.objectContaining({ code: "RFC_REQUIRED" }),
    );
  });

  it("fails closed when implementation paths exceed the classified exemption", () => {
    expect(validateMaintenanceDiffScope({
      category: "docs-only",
      changedPaths: ["README.md", "docs/usage.mdx"],
      contractRefs: [],
    })).toEqual([]);
    expect(validateMaintenanceDiffScope({
      category: "docs-only",
      changedPaths: ["src/engine.ts", "rfcs/RFC-0002-change/rfc.md"],
      contractRefs: [],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MAINTENANCE_DIFF_SCOPE_VIOLATION" }),
      expect.objectContaining({ code: "MAINTENANCE_RFC_MUTATION" }),
    ]));
    expect(validateMaintenanceDiffScope({
      category: "docs-only",
      changedPaths: ["src/public-api.md", "openspec/specs/public-contract.md"],
      contractRefs: [],
    })).toEqual([
      expect.objectContaining({ code: "MAINTENANCE_DIFF_SCOPE_VIOLATION" }),
      expect.objectContaining({ code: "MAINTENANCE_DIFF_SCOPE_VIOLATION" }),
    ]);

    expect(validateMaintenanceDiffScope({
      category: "test-only",
      changedPaths: ["test/api.test.ts", "fixtures/result.json"],
      contractRefs: [],
    })).toEqual([]);
    expect(validateMaintenanceDiffScope({
      category: "test-only",
      changedPaths: ["src/api.ts"],
      contractRefs: [],
    })).toEqual([expect.objectContaining({ code: "MAINTENANCE_DIFF_SCOPE_VIOLATION" })]);

    expect(validateMaintenanceDiffScope({
      category: "dependency-maintenance",
      changedPaths: ["pnpm-lock.yaml"],
      contractRefs: [],
    })).toEqual([]);
    expect(validateMaintenanceDiffScope({
      category: "dependency-maintenance",
      changedPaths: ["package.json"],
      contractRefs: [],
    })).toEqual([expect.objectContaining({ code: "MAINTENANCE_DIFF_UNPROVABLE" })]);

    expect(validateMaintenanceDiffScope({
      category: "internal-refactor",
      changedPaths: ["src/internal/cache.ts"],
      contractRefs: ["spec:cache"],
    })).toEqual([]);
    expect(validateMaintenanceDiffScope({
      category: "internal-refactor",
      changedPaths: ["src/config/loader.ts"],
      contractRefs: [],
    })).toEqual([expect.objectContaining({ code: "MAINTENANCE_PUBLIC_SURFACE" })]);

    expect(validateMaintenanceDiffScope({
      category: "contract-bug",
      changedPaths: ["src/engine.ts"],
      contractRefs: ["RFC-0001-project-foundation/AC-001"],
    })).toEqual([]);
    expect(validateMaintenanceDiffScope({
      category: "contract-bug",
      changedPaths: ["src/data/model.ts"],
      contractRefs: ["RFC-0001-project-foundation/AC-001"],
    })).toEqual([expect.objectContaining({ code: "MAINTENANCE_PUBLIC_SURFACE" })]);
  });
});
