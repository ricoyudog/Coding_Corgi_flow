import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateMermaid, generateDot, buildDepTree } from "../lib/graph.js";

describe("generateMermaid", () => {
  it("produces valid mermaid graph syntax", () => {
    const skills = [
      { meta: { slug: "resolve-config", tier: "atom", depends_on: [], platform: "universal" } },
      { meta: { slug: "opsx-propose", tier: "molecule", depends_on: ["resolve-config"], platform: "universal" } },
    ];
    const output = generateMermaid(skills);
    assert.ok(output.includes("graph TD"));
    assert.ok(output.includes("opsx-propose --> resolve-config"));
    assert.ok(output.includes("resolve-config"));
    assert.ok(output.includes("opsx-propose"));
  });

  it("handles skills with no dependencies", () => {
    const skills = [
      { meta: { slug: "resolve-config", tier: "atom", depends_on: [], platform: "universal" } },
    ];
    const output = generateMermaid(skills);
    assert.ok(output.includes("resolve-config"));
    assert.ok(!output.includes("-->"));
  });
});

describe("generateDot", () => {
  it("produces valid dot syntax", () => {
    const skills = [
      { meta: { slug: "resolve-config", tier: "atom", depends_on: [], platform: "universal" } },
      { meta: { slug: "opsx-propose", tier: "molecule", depends_on: ["resolve-config"], platform: "universal" } },
    ];
    const output = generateDot(skills);
    assert.ok(output.includes("digraph"));
    assert.ok(output.includes('"opsx-propose" -> "resolve-config"'));
  });
});

describe("buildDepTree", () => {
  it("returns full dependency tree for a slug", () => {
    const skills = [
      { meta: { slug: "resolve-config", tier: "atom", depends_on: [], platform: "universal" } },
      { meta: { slug: "parse-tasks", tier: "atom", depends_on: [], platform: "universal" } },
      { meta: { slug: "opsx-propose", tier: "molecule", depends_on: ["resolve-config", "parse-tasks"], platform: "universal" } },
    ];
    const tree = buildDepTree(skills, "opsx-propose");
    assert.deepStrictEqual(tree.slug, "opsx-propose");
    assert.equal(tree.children.length, 2);
    assert.ok(tree.children.some((c) => c.slug === "resolve-config"));
    assert.ok(tree.children.some((c) => c.slug === "parse-tasks"));
  });

  it("returns null for unknown slug", () => {
    const tree = buildDepTree([], "nonexistent");
    assert.equal(tree, null);
  });
});
