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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
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
  "corgispec-gh-explore",
  "corgispec-explore",
] as const;

const CONTRACT_FILES = [
  "molecules/corgispec-gh-propose/SKILL.md",
  "molecules/corgispec-propose/references/gitlab-issues.md",
  "molecules/corgispec-gh-review/SKILL.md",
  "molecules/corgispec-review/SKILL.md",
  "molecules/corgispec-verify/SKILL.md",
  "molecules/corgispec-human-qa/SKILL.md",
  "molecules/corgispec-gh-archive/SKILL.md",
  "molecules/corgispec-archive-change/SKILL.md",
  "molecules/corgispec-gh-explore/SKILL.md",
  "molecules/corgispec-explore/SKILL.md",
] as const;

const LOOP_GUARDED_LIFECYCLE_SKILLS = [
  "corgispec-gh-review",
  "corgispec-review",
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

describe("single-Issue tracker contract", () => {
  const ghPropose = read(resolve(OPENCODE_SKILLS, "molecules/corgispec-gh-propose/SKILL.md"));
  const glPropose = read(
    resolve(OPENCODE_SKILLS, "molecules/corgispec-propose/references/gitlab-issues.md"),
  );
  const ghReview = read(resolve(OPENCODE_SKILLS, "molecules/corgispec-gh-review/SKILL.md"));
  const glReview = read(resolve(OPENCODE_SKILLS, "molecules/corgispec-review/SKILL.md"));
  const ghArchive = read(resolve(OPENCODE_SKILLS, "molecules/corgispec-gh-archive/SKILL.md"));
  const glArchive = read(resolve(OPENCODE_SKILLS, "molecules/corgispec-archive-change/SKILL.md"));

  it("creates exactly one tracker Issue and stores only its identifier", () => {
    for (const propose of [ghPropose, glPropose]) {
      expect(propose.toLowerCase()).toContain("create exactly one issue");
      expect(propose).toContain("<!-- corgispec:task-dashboard:start -->");
      expect(propose).toContain("<!-- corgispec:task-dashboard:end -->");
      expect(propose).toContain("## Task Dashboard");
      expect(propose).toContain("tasks complete · 0/<total groups> groups approved");
      expect(propose).toContain("| Group | Name | Status |");
      expect(propose).not.toMatch(/^\s*parent:/m);
      expect(propose).not.toMatch(/^\s*groups:/m);
      expect(propose).not.toContain("one child issue per Task Group");
    }

    expect(ghPropose).toMatch(/issue:\n\s+number: <issue-number>\n\s+url: <issue-url>/);
    expect(glPropose).toMatch(/issue:\n\s+iid: <issue-iid>\n\s+url: <issue-url>/);
  });

  it("rejects legacy tracker state before tracker mutation", () => {
    for (const file of CONTRACT_FILES) {
      const contract = read(resolve(OPENCODE_SKILLS, file));
      expect(contract, file).toMatch(/legacy `parent` or `groups`|legacy `parent`\/`groups`/i);
      expect(contract, file).toMatch(/unsupported|stop/i);
    }
  });

  it("defines review and archive transitions on the single Issue", () => {
    expect(ghReview).toContain("move the Issue from `review` to `todo`");
    expect(ghReview).toContain("keep it in `review` for Human QA and archive");
    expect(glReview).toContain("move `workflow::review` to `workflow::todo`");
    expect(glReview).toContain("retain `workflow::review` for Human QA and archive");
    expect(ghArchive).toContain("move the Issue to `done`");
    expect(glArchive).toContain("move the Issue to `workflow::done`");
  });

  it("removes operational child-Issue routing from active contracts", () => {
    const operationalLegacy = [
      /groups\[\]\./,
      /<child_(?:number|iid)>/,
      /move the child/i,
      /update parent progress/i,
      /one child issue per Task Group/i,
    ];

    for (const file of CONTRACT_FILES) {
      const contract = read(resolve(OPENCODE_SKILLS, file));
      for (const pattern of operationalLegacy) expect(contract, file).not.toMatch(pattern);
    }
  });

  it("defers same-change lifecycle tracker writes to an active canonical loop", () => {
    for (const skill of LOOP_GUARDED_LIFECYCLE_SKILLS) {
      const contract = read(resolve(OPENCODE_SKILLS, "molecules", skill, "SKILL.md"));
      expect(contract, skill).toContain('corgispec loop inspect "<change>" --json');
      expect(contract, skill).toContain("non-terminal `state.phase`");
      expect(contract, skill).toContain("`sync_tracker`");
      expect(contract, skill).toContain("`finalize`");
      expect(contract, skill).toContain("invoking `gh`/`glab`");
      expect(contract, skill).toContain("`not_found`");
      expect(contract, skill).toContain("different change does not block this workflow");
    }

    for (const skill of ["corgispec-gh-archive", "corgispec-archive-change"] as const) {
      const contract = read(resolve(OPENCODE_SKILLS, "molecules", skill, "SKILL.md"));
      expect(contract, skill).toContain("archive is final-only");
      expect(contract, skill).toContain("all task checkboxes complete and every Group row `done`");
      expect(contract, skill).toContain("Never rebuild, refresh, or backfill task checkboxes or Group progress");
      expect(contract, skill).toContain("only post the final summary and apply the final label/close policy");
      expect(contract, skill).not.toContain("Refresh final task/group progress");
    }
  });
});

describe("single-Issue public workflow assets", () => {
  it("describes one dashboard in schemas, templates, and READMEs", () => {
    const publicFiles = [
      "openspec/schemas/github-tracked/schema.yaml",
      "openspec/schemas/github-tracked/templates/proposal.md",
      "openspec/schemas/github-tracked/templates/tasks.md",
      "openspec/schemas/gitlab-tracked/schema.yaml",
      "openspec/schemas/gitlab-tracked/templates/proposal.md",
      "openspec/schemas/gitlab-tracked/templates/tasks.md",
      "README.md",
      "README.zh-TW.md",
    ];

    for (const file of publicFiles) {
      const content = read(resolve(REPO_ROOT, file));
      expect(content, file).not.toMatch(/parent\s*[+/]\s*child|parent\/child|becomes? a child issue|變成 child issue/i);
    }

    expect(read(resolve(REPO_ROOT, "README.md"))).toContain("One GitLab or GitHub Issue per change");
    expect(read(resolve(REPO_ROOT, "README.zh-TW.md"))).toContain("每個 change 只建立一張");
  });
});

describe("single-Issue mirrors and package assets", () => {
  let assetsRoot: string;

  beforeAll(() => {
    assetsRoot = mkdtempSync(resolve(tmpdir(), "corgispec-single-issue-assets-"));
    execFileSync(process.execPath, ["scripts/bundle-assets.js"], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, CORGISPEC_ASSETS_DIR: assetsRoot },
      stdio: "pipe",
    });
  });

  afterAll(() => {
    rmSync(assetsRoot, { recursive: true, force: true });
  });

  for (const skill of TRACKER_SKILLS) {
    it(`${skill} is identical in Claude and bundled assets`, () => {
      const canonical = resolve(OPENCODE_SKILLS, "molecules", skill);
      const claude = resolve(CLAUDE_SKILLS, "molecules", skill);
      const bundled = resolve(assetsRoot, "skills/molecules", skill);
      const canonicalFiles = listFiles(canonical);
      const mirroredFiles = skill === "corgispec-human-qa"
        ? canonicalFiles.filter((file) => file !== "skill.meta.json")
        : canonicalFiles;

      expect(existsSync(bundled)).toBe(true);
      expect(listFiles(claude)).toEqual(mirroredFiles);
      expect(listFiles(bundled)).toEqual(canonicalFiles);
      for (const file of mirroredFiles) {
        expect(read(resolve(claude, file)), file).toBe(read(resolve(canonical, file)));
      }
      for (const file of canonicalFiles) {
        expect(read(resolve(bundled, file)), file).toBe(read(resolve(canonical, file)));
      }
    });
  }
});
