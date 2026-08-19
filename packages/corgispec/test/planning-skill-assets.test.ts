import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import {
  discoverSkills,
  validateSkill,
  type SkillTier,
} from "../src/lib/skills.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const OPENCODE_SKILLS = resolve(REPO_ROOT, ".opencode/skills");
const CLAUDE_SKILLS = resolve(REPO_ROOT, ".claude/skills");

const SKILLS = [
  { slug: "corgispec-ready", tier: "atoms" },
  { slug: "corgispec-propose", tier: "molecules" },
  { slug: "corgispec-gh-propose", tier: "molecules" },
  { slug: "corgispec-update", tier: "molecules" },
] as const;

const WORKFLOW_HOOK_SKILLS = [
  { slug: "corgispec-propose", tier: "molecules", stop: false },
  { slug: "corgispec-gh-propose", tier: "molecules", stop: false },
  { slug: "corgispec-update", tier: "molecules", stop: false },
  { slug: "corgispec-archive-change", tier: "molecules", stop: false },
  { slug: "corgispec-gh-archive", tier: "molecules", stop: false },
  { slug: "corgispec-human-qa", tier: "molecules", stop: false },
  { slug: "corgispec-apply", tier: "compounds", stop: false },
] as const;

const PRE_WRITE_HOOK = [{
  matcher: "Edit|Write",
  hooks: [{ type: "command", command: "corgispec hook pre-write" }],
}];

const STOP_HOOK = [{
  hooks: [{ type: "command", command: "corgispec hook stop-check" }],
}];

function listFiles(root: string, current = root): string[] {
  return readdirSync(current, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(current, entry.name);
      return entry.isDirectory() ? listFiles(root, path) : [relative(root, path)];
    })
    .sort();
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function readFrontmatter(path: string): Record<string, any> {
  const markdown = read(path);
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  expect(match, `${path} should contain YAML frontmatter`).not.toBeNull();
  return yaml.load(match![1]!) as Record<string, any>;
}

describe("planning skill metadata", () => {
  const discovered = discoverSkills(OPENCODE_SKILLS);
  const tiers = new Map<string, SkillTier>(
    discovered.map((skill) => [skill.slug, skill.meta.tier])
  );

  for (const { slug, tier } of SKILLS) {
    it(`${slug} has valid metadata and skill-creator frontmatter`, () => {
      const skill = discovered.find((candidate) => candidate.slug === slug);
      expect(skill, `${slug} should be discoverable`).toBeDefined();
      expect(validateSkill(skill!, tiers, resolve(REPO_ROOT, "schemas"))).toEqual([]);

      const markdown = read(resolve(OPENCODE_SKILLS, tier, slug, "SKILL.md"));
      const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatter).not.toBeNull();
      expect(frontmatter![1]!.match(/^\w[\w-]*:/gm)).toEqual(
        slug === "corgispec-ready"
          ? ["name:", "description:"]
          : ["name:", "description:", "hooks:"],
      );
      expect(markdown.split("\n").length).toBeLessThan(500);
    });
  }

  it("models ready as the planning atom for update", () => {
    const ready = discovered.find((skill) => skill.slug === "corgispec-ready")!;
    const update = discovered.find((skill) => skill.slug === "corgispec-update")!;

    expect(ready.meta.tier).toBe("atom");
    expect(ready.meta.depends_on).toEqual([]);
    expect(update.meta.tier).toBe("molecule");
    expect(update.meta.depends_on).toEqual(["corgispec-ready"]);
    expect(ready.meta.installation.targets).toEqual(["opencode", "claude", "codex"]);
    expect(update.meta.installation.targets).toEqual(["opencode", "claude", "codex"]);
  });
});

describe("workflow skill hook frontmatter", () => {
  for (const { slug, tier, stop } of WORKFLOW_HOOK_SKILLS) {
    it(`${slug} scopes write and stop enforcement to its active lifecycle`, () => {
      const canonical = resolve(OPENCODE_SKILLS, tier, slug, "SKILL.md");
      const mirror = resolve(CLAUDE_SKILLS, tier, slug, "SKILL.md");

      expect(read(mirror)).toBe(read(canonical));
      expect(readFrontmatter(canonical).hooks).toEqual(
        stop
          ? { PreToolUse: PRE_WRITE_HOOK, Stop: STOP_HOOK }
          : { PreToolUse: PRE_WRITE_HOOK },
      );
      expect(readFrontmatter(mirror).hooks).toEqual(
        stop
          ? { PreToolUse: PRE_WRITE_HOOK, Stop: STOP_HOOK }
          : { PreToolUse: PRE_WRITE_HOOK },
      );
      if (slug === "corgispec-apply") {
        expect(readFrontmatter(canonical).metadata).toMatchObject({
          "opencode/autoinvoke": "false",
        });
        expect(readFrontmatter(canonical)["disable-model-invocation"]).toBe(true);
      }
    });
  }

  it("does not attach workflow enforcement hooks to unrelated skills", () => {
    const hookedSkills = listFiles(OPENCODE_SKILLS)
      .filter((path) => path.endsWith("/SKILL.md"))
      .map((path) => readFrontmatter(resolve(OPENCODE_SKILLS, path)))
      .filter((frontmatter) => frontmatter.hooks !== undefined)
      .map((frontmatter) => frontmatter.name)
      .sort();

    expect(hookedSkills).toEqual(
      WORKFLOW_HOOK_SKILLS.map(({ slug }) => slug).sort(),
    );
  });
});

describe("planning skill mirrors", () => {
  for (const { slug, tier } of SKILLS) {
    it(`${slug} is byte-identical across canonical and Claude trees`, () => {
      const canonical = resolve(OPENCODE_SKILLS, tier, slug);
      const mirror = resolve(CLAUDE_SKILLS, tier, slug);
      const files = listFiles(canonical);

      expect(listFiles(mirror)).toEqual(files);
      for (const file of files) {
        expect(read(resolve(mirror, file)), file).toBe(read(resolve(canonical, file)));
      }
    });
  }
});

describe("planning workflow guardrails", () => {
  const ready = read(
    resolve(OPENCODE_SKILLS, "atoms/corgispec-ready/SKILL.md")
  );
  const propose = read(
    resolve(OPENCODE_SKILLS, "molecules/corgispec-propose/SKILL.md")
  );
  const ghPropose = read(
    resolve(OPENCODE_SKILLS, "molecules/corgispec-gh-propose/SKILL.md")
  );
  const update = read(
    resolve(OPENCODE_SKILLS, "molecules/corgispec-update/SKILL.md")
  );

  it("keeps ready read-only and separates deterministic from semantic findings", () => {
    expect(ready).toContain("Keep this workflow read-only");
    expect(ready).toContain("artifactPaths.<id>.existingOutputPaths");
    expect(ready).toContain("Keep deterministic checks separate from semantic findings");
    expect(ready).toContain("State explicitly that the review made no file changes");
  });

  it("keeps every propose provider planning-only until a later explicit apply request", () => {
    expect(propose).toContain("Propose is planning-only and provider-neutral");
    expect(propose).toContain("Keep `HEAD` unchanged throughout Propose");
    expect(propose).toContain("Do not turn free-form Feature prose into an RFC");
    expect(propose).toContain("--maintenance --description");
    expect(propose).toContain("Do not edit `corgi/source.yaml`");
    expect(propose).toContain("--finalize --json");
    expect(propose).toContain("Do not install packages, implement code, create commits, push");
    expect(ghPropose).toContain("Follow **corgispec-propose** without adding provider-specific behavior");
    expect(ghPropose).toContain("--finalize --json");
    expect(propose).not.toContain("$corgispec-loop");
    expect(ghPropose).not.toContain("$corgispec-loop");
    expect(propose).not.toContain("corgispec-apply-change");
    expect(ghPropose).not.toContain("corgispec-gh-apply");
  });

  it("blocks active or legacy runs and constrains update writes to authoritative artifacts", () => {
    expect(update).toContain("PENDING_CONVERGENCE");
    expect(update).toContain("v4 has no Converge command");
    expect(update).toContain("`corgispec change repair`");
    expect(update).toContain("active Run Contract v3");
    expect(update).toContain("accepted Amendment RFC");
    expect(update).toContain("legacy active-run data");
    expect(update).toContain("existingArtifactIds");
    expect(update).toContain("missingArtifactIds");
    expect(update).toContain("existingOutputPaths");
    expect(update).toContain("changeRoot");
    expect(update).toContain("explicit approval for that artifact only");
    expect(update).toContain("openspec validate \"<change>\" --strict --no-interactive");
    expect(update).toContain("corgispec ready \"<change>\" --strict --json");
    expect(update).toContain("do not derive or write execution status from task checkboxes");
    expect(update).toContain("Run Contract v3 records lifecycle completion");
    expect(update).not.toContain("Keep `[x]` only when semantics");
  });

  it("routes both platform wrappers to the matching skill", () => {
    const openCodePropose = read(resolve(REPO_ROOT, ".opencode/commands/corgi-propose.md"));
    const claudePropose = read(resolve(REPO_ROOT, ".claude/commands/corgi/propose.md"));
    for (const wrapper of [openCodePropose, claudePropose]) {
      expect(wrapper).toContain("Throughout propose, keep `HEAD` unchanged.");
      expect(wrapper).toContain("Do not install packages, create commits, push branches, open implementation pull requests, or publish at any point.");
      expect(wrapper).toContain("Propose is a planning-only workflow and is terminal for the current turn.");
      expect(wrapper).toContain("it is not user approval to implement");
      expect(wrapper).toContain("After reporting, end the current turn.");
      expect(wrapper).toContain("Implementation may begin only after a later explicit user request");
    }
    expect(openCodePropose).toContain("`/corgi-apply <change>`");
    expect(claudePropose).toContain("`/corgi:apply <change>`");
    expect(openCodePropose).not.toContain("/corgi-loop");
    expect(claudePropose).not.toContain("/corgi:loop");

    expect(read(resolve(REPO_ROOT, ".opencode/commands/corgi-ready.md"))).toContain(
      "**corgispec-ready**"
    );
    expect(read(resolve(REPO_ROOT, ".opencode/commands/corgi-update.md"))).toContain(
      "**corgispec-update**"
    );
    expect(read(resolve(REPO_ROOT, ".claude/commands/corgi/ready.md"))).toContain(
      "/corgi:ready"
    );
    expect(read(resolve(REPO_ROOT, ".claude/commands/corgi/update.md"))).toContain(
      "/corgi:update"
    );
    expect(existsSync(resolve(REPO_ROOT, ".opencode/commands/corgi-converge.md"))).toBe(false);
    expect(existsSync(resolve(REPO_ROOT, ".claude/commands/corgi/converge.md"))).toBe(false);
  });
});

describe("bundled planning assets", () => {
  let assetsRoot: string;

  beforeAll(() => {
    assetsRoot = mkdtempSync(resolve(tmpdir(), "corgispec-planning-assets-"));
    execFileSync(process.execPath, ["scripts/bundle-assets.js"], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, CORGISPEC_ASSETS_DIR: assetsRoot },
      stdio: "pipe",
    });
  }, 60_000);

  afterAll(() => {
    rmSync(assetsRoot, { recursive: true, force: true });
  });

  for (const { slug, tier } of SKILLS) {
    it(`bundles ${slug} with identical canonical content`, () => {
      const source = resolve(OPENCODE_SKILLS, tier, slug);
      const bundled = resolve(assetsRoot, "skills", tier, slug);
      expect(existsSync(bundled)).toBe(true);
      expect(statSync(bundled).isDirectory()).toBe(true);
      expect(listFiles(bundled)).toEqual(listFiles(source));

      for (const file of listFiles(source)) {
        expect(read(resolve(bundled, file)), file).toBe(read(resolve(source, file)));
      }
    });
  }

  it("bundles both OpenCode and Claude command wrappers", () => {
    const pairs = [
      ["commands/opencode/corgi-propose.md", ".opencode/commands/corgi-propose.md"],
      ["commands/opencode/corgi-ready.md", ".opencode/commands/corgi-ready.md"],
      ["commands/opencode/corgi-update.md", ".opencode/commands/corgi-update.md"],
      ["commands/claude/corgi/propose.md", ".claude/commands/corgi/propose.md"],
      ["commands/claude/corgi/ready.md", ".claude/commands/corgi/ready.md"],
      ["commands/claude/corgi/update.md", ".claude/commands/corgi/update.md"],
    ] as const;

    for (const [bundled, source] of pairs) {
      expect(read(resolve(assetsRoot, bundled)), bundled).toBe(read(resolve(REPO_ROOT, source)));
    }
  });
});
