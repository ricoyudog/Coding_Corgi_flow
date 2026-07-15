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
  { slug: "corgispec-update", tier: "molecules" },
  { slug: "corgispec-converge", tier: "molecules" },
] as const;

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
      expect(frontmatter![1]!.match(/^\w[\w-]*:/gm)).toEqual([
        "name:",
        "description:",
      ]);
      expect(markdown.split("\n").length).toBeLessThan(500);
    });
  }

  it("models ready as the planning atom for update and converge", () => {
    const ready = discovered.find((skill) => skill.slug === "corgispec-ready")!;
    const update = discovered.find((skill) => skill.slug === "corgispec-update")!;
    const converge = discovered.find((skill) => skill.slug === "corgispec-converge")!;

    expect(ready.meta.tier).toBe("atom");
    expect(ready.meta.depends_on).toEqual([]);
    expect(update.meta.tier).toBe("molecule");
    expect(update.meta.depends_on).toEqual(["corgispec-ready"]);
    expect(converge.meta.tier).toBe("molecule");
    expect(converge.meta.depends_on).toEqual(["corgispec-ready"]);
    expect(ready.meta.installation.targets).toEqual(["opencode", "claude", "codex"]);
    expect(update.meta.installation.targets).toEqual(["opencode", "claude", "codex"]);
    expect(converge.meta.installation.targets).toEqual(["opencode", "claude", "codex"]);
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
  const update = read(
    resolve(OPENCODE_SKILLS, "molecules/corgispec-update/SKILL.md")
  );
  const converge = read(
    resolve(OPENCODE_SKILLS, "molecules/corgispec-converge/SKILL.md")
  );

  it("keeps ready read-only and separates deterministic from semantic findings", () => {
    expect(ready).toContain("Keep this workflow read-only");
    expect(ready).toContain("artifactPaths.<id>.existingOutputPaths");
    expect(ready).toContain("Keep deterministic checks separate from semantic findings");
    expect(ready).toContain("State explicitly that the review made no file changes");
  });

  it("blocks active v1 runs and constrains update writes to authoritative artifacts", () => {
    expect(update).toContain("PENDING_CONVERGENCE");
    expect(update).toContain("ACTIVE_V2_RUN");
    expect(update).toContain("ACTIVE_V1_RUN");
    expect(update).toContain("existingArtifactIds");
    expect(update).toContain("missingArtifactIds");
    expect(update).toContain("existingOutputPaths");
    expect(update).toContain("changeRoot");
    expect(update).toContain("explicit approval for that artifact only");
    expect(update).toContain("openspec validate \"<change>\" --strict --no-interactive");
    expect(update).toContain("corgispec ready \"<change>\" --strict --json");
  });

  it("keeps converge evidence-driven, read-only first, and append-only after approval", () => {
    expect(converge).toContain("The initial evaluation is read-only");
    expect(converge).toContain("planningRevision");
    expect(converge).toContain("confirmationToken");
    expect(converge).toContain("append exactly one new Task Group");
    expect(converge).toContain("preserve every old group byte-for-byte");
    expect(converge).toContain("rerun the exact same command with the same `confirmationToken`");
    expect(converge).toContain("durable convergence intent to resume idempotently");
    expect(converge).toContain("If the CLI returns a contract error, stop");
    expect(converge).toContain("Never edit the task artifact or any other planning file yourself");
    expect(converge).toContain("Only the CLI may persist or recover");
  });

  it("ships converge as a Codex-discoverable universal skill", () => {
    const openAiMetadata = read(
      resolve(OPENCODE_SKILLS, "molecules/corgispec-converge/agents/openai.yaml")
    );
    expect(openAiMetadata).toContain('display_name: "CorgiSpec Converge"');
    expect(openAiMetadata).toContain("$corgispec-converge");
    expect(
      read(resolve(CLAUDE_SKILLS, "molecules/corgispec-converge/agents/openai.yaml"))
    ).toBe(openAiMetadata);
  });

  it("routes both platform wrappers to the matching skill", () => {
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
    expect(read(resolve(REPO_ROOT, ".opencode/commands/corgi-converge.md"))).toContain(
      "**corgispec-converge**"
    );
    expect(read(resolve(REPO_ROOT, ".opencode/commands/corgi-converge.md"))).toContain(
      "rerun with that same token"
    );
    expect(read(resolve(REPO_ROOT, ".claude/commands/corgi/converge.md"))).toContain(
      "/corgi:converge"
    );
    expect(read(resolve(REPO_ROOT, ".claude/commands/corgi/converge.md"))).toContain(
      "stop on contract errors"
    );
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
  });

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
      ["commands/opencode/corgi-ready.md", ".opencode/commands/corgi-ready.md"],
      ["commands/opencode/corgi-update.md", ".opencode/commands/corgi-update.md"],
      ["commands/claude/corgi/ready.md", ".claude/commands/corgi/ready.md"],
      ["commands/claude/corgi/update.md", ".claude/commands/corgi/update.md"],
      ["commands/opencode/corgi-converge.md", ".opencode/commands/corgi-converge.md"],
      ["commands/claude/corgi/converge.md", ".claude/commands/corgi/converge.md"],
    ] as const;

    for (const [bundled, source] of pairs) {
      expect(read(resolve(assetsRoot, bundled)), bundled).toBe(read(resolve(REPO_ROOT, source)));
    }
  });
});
