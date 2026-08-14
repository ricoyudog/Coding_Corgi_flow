import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");

function read(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

describe("Run Contract v3 public skill chain", () => {
  const apply = read(".opencode/skills/compounds/corgispec-apply/SKILL.md");
  const verify = read(".opencode/skills/molecules/corgispec-verify/SKILL.md");
  const review = read(".opencode/skills/molecules/corgispec-review/SKILL.md");
  const qa = read(".opencode/skills/molecules/corgispec-human-qa/SKILL.md");
  const archive = read(".opencode/skills/molecules/corgispec-archive-change/SKILL.md");
  const memoryExtract = read(".opencode/skills/atoms/corgispec-memory-extract/SKILL.md");
  const groupReview = read(".opencode/skills/molecules/corgispec-review-loop/SKILL.md");

  it("keeps Apply as the explicit implementation entry with per-group commits", () => {
    expect(read(".claude/skills/compounds/corgispec-apply/SKILL.md")).toBe(apply);
    expect(read("packages/corgispec/assets/skills/compounds/corgispec-apply/SKILL.md")).toBe(apply);
    expect(apply).toContain("Run Contract v3");
    expect(apply).toContain("only public implementation entry");
    expect(apply).toContain('opencode/autoinvoke: "false"');
    expect(apply).toContain("disable-model-invocation: true");
    expect(apply).toContain("Never combine multiple Task Groups in one commit");
    expect(apply).toContain("stateRevision");
    expect(apply).toContain("nonce");
    expect(apply).toContain("planning-baseline commit");
    expect(apply).toContain("planning artifacts, including task checkboxes, are frozen");
    expect(apply).toContain("Do not broaden RFC scope, edit `source.yaml`, or modify planning artifacts/task checkboxes after the planning-baseline commit");
    expect(apply).toContain("Run Contract v3 is the lifecycle authority and the CLI-managed Issue dashboard is the tracker view of progress");
    expect(apply).toContain("awaiting_verify");
    expect(apply).toContain('--session "<session-id>" --owner "<agent-id>"');
    expect(apply).toContain('--evidence "<JSON-file>" --run-id "<runId>"');
    expect(apply).not.toContain("[--tracker-checkpoint");
    expect(apply).toContain("Do not run final Verify, human Review, Human QA, Archive");
  });

  it("separates the canonical whole-change gates", () => {
    expect(verify).toContain("complete project test/build/lint/integration suite");
    expect(verify).toContain("For every source AC");
    expect(verify).toContain("awaiting_human_review");
    expect(verify).toContain('--report "<verify-report.json>" --run-id "<runId>"');
    expect(review).toContain("--reject-implementation");
    expect(review).toContain("--require-rfc-amendment");
    expect(review).toContain('--approve --reviewer "<human-id>" --run-id "<runId>"');
    expect(review).toContain("Only a human may choose");
    expect(qa).toContain("real user paths");
    expect(qa).toContain('--report "<qa-report.json>" --run-id "<runId>"');
    expect(qa).toContain("human reviewer explicitly supplies identity and reason");
    expect(archive).toContain("ready_for_archive");
    expect(archive).toContain("canonical evidence materialized");
    expect(archive).toContain("wiki/deliveries/<RFC-ID>-<Slice-ID>.md");
    expect(archive).toContain("`corgispec archive --local` is the sole write transaction");
    for (const operation of ["--begin", "--local", "--confirm-tracker", "--finish"]) {
      expect(archive).toContain(operation);
    }
  });

  it("keeps archive knowledge materialization in the CLI and extraction read-only", () => {
    const packagedExtract = read(
      "packages/corgispec/assets/skills/atoms/corgispec-memory-extract/SKILL.md",
    );

    expect(read(".claude/skills/atoms/corgispec-memory-extract/SKILL.md")).toBe(memoryExtract);
    expect(packagedExtract).toBe(memoryExtract);
    expect(memoryExtract).toContain("read-only preflight before `corgispec archive --local`");
    expect(memoryExtract).toContain("`corgispec archive --local` is the sole writer");
    expect(memoryExtract).toContain("Do not repair it manually after the closeout commit is sealed");
    expect(memoryExtract).not.toContain("## Write the Delivery Page");
    expect(memoryExtract).not.toContain("## Promote Knowledge");
    expect(memoryExtract).not.toContain("## Close the Bridge");
  });

  it("documents frozen planning checkboxes in public READMEs", () => {
    const english = read("README.md");
    const traditionalChinese = read("README.zh-TW.md");

    expect(english).toContain("Do not modify planning artifacts or task checkboxes after the planning baseline");
    expect(english).toContain("Run Contract v3 records lifecycle progress");
    expect(english).not.toContain("Mark tasks as [x] when done.");
    expect(traditionalChinese).toContain("planning baseline 後不得修改 planning artifact 或 task checkbox");
    expect(traditionalChinese).toContain("Run Contract v3 記錄 lifecycle progress");
    expect(traditionalChinese).not.toContain("完成後將 tasks 標記為 [x]");
  });

  it("keeps automated Task Group review distinct from human review", () => {
    expect(groupReview).toContain("automated review findings");
    expect(groupReview).toContain("this is not canonical whole-change Verify or Human Review");
    expect(groupReview).toContain("no file was changed");
  });

  it("routes public wrappers through the explicit quality chain", () => {
    expect(read(".opencode/commands/corgi-apply.md")).toContain("**corgispec-apply**");
    expect(read(".claude/commands/corgi/apply.md")).toContain("**corgispec-apply**");
    expect(read(".opencode/commands/corgi-verify.md")).toContain("**corgispec-verify**");
    expect(read(".opencode/commands/corgi-review.md")).toContain("**corgispec-review**");
    expect(read(".opencode/commands/corgi-human-qa.md")).toContain("**corgispec-human-qa**");
    expect(read(".opencode/commands/corgi-archive.md")).toContain("**corgispec-archive-change**");
  });

  it("ships v4 metadata and Codex discovery policy", () => {
    const metadata = JSON.parse(read(".opencode/skills/compounds/corgispec-apply/skill.meta.json"));
    expect(metadata.version).toBe("4.0.0-rc1");
    expect(metadata.installation.targets).toEqual(["opencode", "claude", "codex"]);
    const openAi = read(".opencode/skills/compounds/corgispec-apply/agents/openai.yaml");
    expect(openAi).toContain("$corgispec-apply");
    expect(openAi).toContain("allow_implicit_invocation: false");
  });

  it("contains no public Run Contract v2 workflow claim", () => {
    for (const path of ["README.md", "README.zh-TW.md", "INSTALL.md", ".opencode/INSTALL.md"]) {
      expect(read(path), path).not.toContain("Run Contract v2");
    }
  });
});
