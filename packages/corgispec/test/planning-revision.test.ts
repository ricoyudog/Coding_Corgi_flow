import { describe, expect, it, vi } from "vitest";
import {
  PlanningRevisionError,
  computePlanningRevision,
  isPathInside,
  normalizePortablePath,
  relativePortablePath,
} from "../src/lib/planning-revision.js";
import type { OpenSpecArtifactPath } from "../src/lib/openspec-adapter.js";

function artifact(
  outputPath: string,
  existingOutputPaths: string[]
): OpenSpecArtifactPath {
  return {
    outputPath,
    resolvedOutputPath: `/store/change/${outputPath}`,
    existingOutputPaths,
  };
}

describe("portable planning paths", () => {
  it("normalizes separators and relative paths", () => {
    expect(normalizePortablePath("specs\\auth\\spec.md")).toBe("specs/auth/spec.md");
    expect(relativePortablePath("/store/change", "/store/change/specs/auth/spec.md")).toBe(
      "specs/auth/spec.md"
    );
    expect(relativePortablePath("/store/change", "/store/change")).toBe(".");
  });

  it("recognizes POSIX containment without prefix confusion", () => {
    expect(isPathInside("/store/change", "/store/change/spec.md")).toBe(true);
    expect(isPathInside("/store/change", "/store/change")).toBe(true);
    expect(isPathInside("/store/change", "/store/change-other/spec.md")).toBe(false);
    expect(isPathInside("/store/change", "/store/change/../secret.md")).toBe(false);
  });

  it("uses win32 semantics for drive and UNC paths", () => {
    expect(isPathInside("C:\\Store\\Change", "c:\\store\\change\\specs\\a.md")).toBe(true);
    expect(isPathInside("C:\\Store\\Change", "D:\\Store\\Change\\a.md")).toBe(false);
    expect(relativePortablePath("C:\\Store\\Change", "C:\\Store\\Change\\specs\\a.md")).toBe(
      "specs/a.md"
    );
    expect(isPathInside("\\\\server\\share\\change", "\\\\server\\share\\change\\a.md")).toBe(
      true
    );
  });
});

describe("computePlanningRevision", () => {
  it("is stable across map/file ordering and duplicate output paths", async () => {
    const contents = new Map<string, Uint8Array>([
      ["/store/change/proposal.md", Buffer.from("proposal")],
      ["/store/change/specs/a.md", Buffer.from("a")],
      ["/store/change/specs/b.md", Buffer.from("b")],
    ]);
    const reader = {
      async read(filePath: string) {
        return contents.get(filePath)!;
      },
    };

    const first = await computePlanningRevision(
      {
        changeRoot: "/store/change",
        schemaName: "custom",
        artifactPaths: {
          specs: artifact("specs/**/*.md", [
            "/store/change/specs/b.md",
            "/store/change/specs/a.md",
            "/store/change/specs/a.md",
          ]),
          proposal: artifact("proposal.md", ["/store/change/proposal.md"]),
        },
      },
      reader
    );
    const second = await computePlanningRevision(
      {
        changeRoot: "/store/change",
        schemaName: "custom",
        artifactPaths: {
          proposal: artifact("proposal.md", ["/store/change/proposal.md"]),
          specs: artifact("specs/**/*.md", [
            "/store/change/specs/a.md",
            "/store/change/specs/b.md",
          ]),
        },
      },
      reader
    );

    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first).toBe(second);
  });

  it("orders mixed-case, numeric, and Unicode artifact paths without localeCompare", async () => {
    const paths = ["A.md", "a10.md", "a2.md", "é.md", "中.md"]
      .map((name) => `/store/change/specs/${name}`);
    const contents = new Map(paths.map((filePath) => [filePath, Buffer.from(filePath)]));
    const input = {
      changeRoot: "/store/change",
      schemaName: "portable-order",
      artifactPaths: { specs: artifact("specs/*.md", [...paths].reverse()) },
    };
    const reader = { async read(filePath: string) { return contents.get(filePath)!; } };
    const expected = await computePlanningRevision(input, reader);
    const localeCompare = vi.spyOn(String.prototype, "localeCompare")
      .mockImplementation(() => { throw new Error("localeCompare must not define a revision"); });
    try {
      await expect(computePlanningRevision(input, reader)).resolves.toBe(expected);
    } finally {
      localeCompare.mockRestore();
    }
  });

  it("binds schema, manifest path, relative file name, and bytes", async () => {
    const base = {
      changeRoot: "/store/change",
      schemaName: "schema-a",
      artifactPaths: {
        proposal: artifact("proposal.md", ["/store/change/proposal.md"]),
      },
    };
    const revision = (input = base, bytes = "same") =>
      computePlanningRevision(input, {
        async read() {
          return Buffer.from(bytes);
        },
      });

    const original = await revision();
    await expect(revision({ ...base, schemaName: "schema-b" })).resolves.not.toBe(original);
    await expect(
      revision({
        ...base,
        artifactPaths: {
          proposal: artifact("planning.md", ["/store/change/proposal.md"]),
        },
      })
    ).resolves.not.toBe(original);
    await expect(
      revision({
        ...base,
        artifactPaths: {
          proposal: artifact("proposal.md", ["/store/change/renamed.md"]),
        },
      })
    ).resolves.not.toBe(original);
    await expect(revision(base, "changed")).resolves.not.toBe(original);
  });

  it("supports an empty artifact manifest", async () => {
    await expect(
      computePlanningRevision(
        { changeRoot: "/store/change", schemaName: "empty", artifactPaths: {} },
        { async read() { throw new Error("must not read"); } }
      )
    ).resolves.toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("fails closed for a path outside changeRoot", async () => {
    await expect(
      computePlanningRevision(
        {
          changeRoot: "/store/change",
          schemaName: "custom",
          artifactPaths: {
            proposal: artifact("proposal.md", ["/store/secret.md"]),
          },
        },
        { async read() { return Buffer.from("secret"); } }
      )
    ).rejects.toEqual(
      expect.objectContaining<Partial<PlanningRevisionError>>({ code: "path_outside_change" })
    );
  });

  it("wraps file read failures with the concrete path", async () => {
    const cause = new Error("EACCES");
    await expect(
      computePlanningRevision(
        {
          changeRoot: "/store/change",
          schemaName: "custom",
          artifactPaths: {
            proposal: artifact("proposal.md", ["/store/change/proposal.md"]),
          },
        },
        { async read() { throw cause; } }
      )
    ).rejects.toMatchObject({
      code: "file_read_failed",
      filePath: "/store/change/proposal.md",
      cause,
    });
  });
});
