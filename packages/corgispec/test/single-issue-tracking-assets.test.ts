import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const OPENCODE_SKILLS = resolve(REPO_ROOT, ".opencode/skills");
const CLAUDE_SKILLS = resolve(REPO_ROOT, ".claude/skills");

const TRACKER_SKILLS = [
  "corgispec-gh-propose",
  "corgispec-propose",
  "corgispec-gh-review",
  "corgispec-review",
  "corgispec-verify",
  "corgispec-human-qa",
  "corgispec-gh-archive",
  "corgispec-archive-change",
] as const;

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function listFiles(root: string, current = root): string[] {
  return readdirSync(current, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(current, entry.name);
      return entry.isDirectory() ? listFiles(root, path) : [relative(root, path)];
    })
    .sort();
}

describe("RFC Slice single-Issue tracker contract", () => {
  const propose = read(resolve(OPENCODE_SKILLS, "molecules/corgispec-propose/SKILL.md"));
  const ghPropose = read(resolve(OPENCODE_SKILLS, "molecules/corgispec-gh-propose/SKILL.md"));
  const verify = read(resolve(OPENCODE_SKILLS, "molecules/corgispec-verify/SKILL.md"));
  const review = read(resolve(OPENCODE_SKILLS, "molecules/corgispec-review/SKILL.md"));
  const qa = read(resolve(OPENCODE_SKILLS, "molecules/corgispec-human-qa/SKILL.md"));
  const archive = read(resolve(OPENCODE_SKILLS, "molecules/corgispec-archive-change/SKILL.md"));

  it("delegates creation, recovery, dashboard finalization, and transitions to the CLI", () => {
    expect(propose).toContain("CLI owns Issue creation/recovery");
    expect(propose).toContain("--finalize --json");
    expect(propose).toContain("move the Issue from backlog to todo");
    expect(propose).toContain("durable intent");
    expect(ghPropose).toContain("without adding provider-specific behavior");
    for (const contract of [propose, ghPropose, verify, review, qa, archive]) {
      expect(contract).not.toMatch(/\b(?:gh|glab)\s+issue\b/u);
      expect(contract).not.toMatch(/one child issue per Task Group/iu);
    }
  });

  it("keeps one Issue for the Slice and all implementation repairs", () => {
    expect(propose).toContain("Task Groups remain sections");
    expect(propose).toContain("never create a Task Group Issue");
    expect(review).toContain("using the same Issue");
    expect(archive).toContain("exactly one Slice binding, Change, archive destination, and single Issue");
  });

  it("models the v4 tracker lifecycle around explicit quality gates", () => {
    expect(propose).toContain("move the Issue from backlog to todo");
    expect(verify).toContain("awaiting_human_review");
    expect(review).toContain("awaiting_human_qa");
    expect(qa).toContain("ready_for_archive");
    expect(archive).toContain("move the one Issue to done and close it idempotently");
  });

  it("documents one Issue per RFC Slice publicly", () => {
    expect(read(resolve(REPO_ROOT, "README.md"))).toContain("One GitLab or GitHub Issue per RFC Slice");
    expect(read(resolve(REPO_ROOT, "README.zh-TW.md"))).toContain("每個 RFC Slice 只建立一張");
  });
});

describe("RFC-first tracker mirrors and package assets", () => {
  let assetsRoot: string;

  beforeAll(() => {
    assetsRoot = mkdtempSync(resolve(tmpdir(), "corgispec-rfc-tracker-assets-"));
    execFileSync(process.execPath, ["scripts/bundle-assets.js"], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, CORGISPEC_ASSETS_DIR: assetsRoot },
      stdio: "pipe",
    });
  }, 60_000);

  afterAll(() => {
    rmSync(assetsRoot, { recursive: true, force: true });
  });

  for (const skill of TRACKER_SKILLS) {
    it(`${skill} is identical in Claude and bundled assets`, () => {
      const canonical = resolve(OPENCODE_SKILLS, "molecules", skill);
      const claude = resolve(CLAUDE_SKILLS, "molecules", skill);
      const bundled = resolve(assetsRoot, "skills/molecules", skill);
      const files = listFiles(canonical);

      expect(existsSync(bundled)).toBe(true);
      expect(listFiles(claude)).toEqual(files);
      expect(listFiles(bundled)).toEqual(files);
      for (const file of files) {
        expect(read(resolve(claude, file)), file).toBe(read(resolve(canonical, file)));
        expect(read(resolve(bundled, file)), file).toBe(read(resolve(canonical, file)));
      }
    });
  }
});
