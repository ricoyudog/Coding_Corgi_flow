import path from "node:path";
import fs from "node:fs/promises";
import { discoverSkills } from "./loader.js";

const TIER_STYLES = {
  atom: { mermaid: "([%s])", dot: 'shape=ellipse, style=filled, fillcolor="#d4edda"' },
  molecule: { mermaid: "[%s]", dot: 'shape=box, style=filled, fillcolor="#cce5ff"' },
  compound: { mermaid: "[[%s]]", dot: 'shape=box3d, style=filled, fillcolor="#fff3cd"' },
};

export function generateMermaid(skills, { tier } = {}) {
  let filtered = skills;
  if (tier) {
    filtered = skills.filter((s) => s.meta.tier === tier);
  }

  const lines = ["graph TD"];

  for (const s of filtered) {
    const style = TIER_STYLES[s.meta.tier] || TIER_STYLES.molecule;
    const shape = style.mermaid.replace("%s", `"${s.meta.slug}"`);
    lines.push(`  ${s.meta.slug}${shape}`);
  }

  const slugSet = new Set(filtered.map((s) => s.meta.slug));
  for (const s of filtered) {
    for (const dep of s.meta.depends_on) {
      if (slugSet.has(dep)) {
        lines.push(`  ${s.meta.slug} --> ${dep}`);
      }
    }
  }

  for (const [tierName, _style] of Object.entries(TIER_STYLES)) {
    const tierSkills = filtered.filter((s) => s.meta.tier === tierName);
    if (tierSkills.length > 0) {
      lines.push(`  subgraph ${tierName}s`);
      for (const s of tierSkills) {
        lines.push(`    ${s.meta.slug}`);
      }
      lines.push("  end");
    }
  }

  return lines.join("\n");
}

export function generateDot(skills, { tier } = {}) {
  let filtered = skills;
  if (tier) {
    filtered = skills.filter((s) => s.meta.tier === tier);
  }

  const lines = ["digraph skills {", "  rankdir=BT;", "  node [fontname=Helvetica];"];

  for (const s of filtered) {
    const style = TIER_STYLES[s.meta.tier] || TIER_STYLES.molecule;
    lines.push(`  "${s.meta.slug}" [${style.dot}, label="${s.meta.slug}"];`);
  }

  const slugSet = new Set(filtered.map((s) => s.meta.slug));
  for (const s of filtered) {
    for (const dep of s.meta.depends_on) {
      if (slugSet.has(dep)) {
        lines.push(`  "${s.meta.slug}" -> "${dep}";`);
      }
    }
  }

  lines.push("}");
  return lines.join("\n");
}

export function buildDepTree(skills, slug) {
  const bySlug = new Map();
  for (const s of skills) {
    bySlug.set(s.meta.slug, s);
  }

  function build(currentSlug, visited = new Set()) {
    const s = bySlug.get(currentSlug);
    if (!s) return null;
    if (visited.has(currentSlug)) return { slug: currentSlug, tier: s.meta.tier, children: [], circular: true };
    visited.add(currentSlug);

    const children = s.meta.depends_on
      .map((dep) => build(dep, new Set(visited)))
      .filter(Boolean);

    return { slug: currentSlug, tier: s.meta.tier, children };
  }

  return build(slug);
}

function formatTree(node, indent = 0) {
  const prefix = "  ".repeat(indent);
  const marker = indent === 0 ? "" : "└─ ";
  let output = `${prefix}${marker}${node.slug} (${node.tier})${node.circular ? " [CIRCULAR]" : ""}\n`;
  for (const child of node.children) {
    output += formatTree(child, indent + 1);
  }
  return output;
}

export async function runGraph(rootPath, { format = "mermaid", tier } = {}) {
  const resolvedPath = path.resolve(rootPath);

  let skillsRoot = resolvedPath;
  const opencodePath = path.join(resolvedPath, ".opencode", "skills");
  try {
    await fs.access(opencodePath);
    skillsRoot = opencodePath;
  } catch {}

  const skills = await discoverSkills(skillsRoot);
  const valid = skills.filter((s) => s.meta);

  if (valid.length === 0) {
    console.log("No skills found.");
    return;
  }

  if (format === "mermaid") {
    console.log(generateMermaid(valid, { tier }));
  } else if (format === "dot") {
    console.log(generateDot(valid, { tier }));
  } else {
    console.error(`Unknown format: ${format}. Use 'mermaid' or 'dot'.`);
  }
}

export async function runCheckDeps(rootPath, slug) {
  const resolvedPath = path.resolve(rootPath);

  let skillsRoot = resolvedPath;
  const opencodePath = path.join(resolvedPath, ".opencode", "skills");
  try {
    await fs.access(opencodePath);
    skillsRoot = opencodePath;
  } catch {}

  const skills = await discoverSkills(skillsRoot);
  const valid = skills.filter((s) => s.meta);
  const tree = buildDepTree(valid, slug);

  if (!tree) {
    console.error(`Skill '${slug}' not found.`);
    process.exit(1);
  }

  console.log(formatTree(tree));
}
