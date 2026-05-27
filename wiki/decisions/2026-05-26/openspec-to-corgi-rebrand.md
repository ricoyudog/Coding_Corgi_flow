---
type: wiki
updated: 2026-05-26
status: proposed
reviewed_by:
  - scope-audit (agent, 2026-05-26)
  - technical-review (agent, 2026-05-26)
  - risk-analysis (agent, 2026-05-26)
review_date: 2026-05-27
---

# Decision: OpenSpec → Corgi Branding 全面替换

> 将所有用户可见的 "OpenSpec" 品牌文本替换为 "Corgi"，使命令、Skill 描述、CLI 输出、文档与斜杠命令 `/corgi-*` 命名一致。

## Context

CorgiSpec 项目起源于 OpenSpec GitFlow 工作流，CLI 工具和斜杠命令已迁移到 `corgispec`/`/corgi-*` 命名体系。经 agent team 全面审查确认：**~85 个文件、~180+ 处引用** 中仍然大量保留 "OpenSpec" 品牌文本（另有 200+ 文件中的 `openspec/` 目录路径引用不在本次范围内）。

| 位置 | 示例 | 用户影响 |
|------|------|---------|
| 命令描述 | `.opencode/commands/corgi-install.md` — "Install OpenSpec GitFlow assets" | OpenCode 命令面板显示 "OpenSpec" |
| Claude 命令名 | `.claude/commands/corgi/install.md` — `name: "OPSX: Install"` | Claude Code 命令列表显示 "OPSX" |
| Skill 描述 | `SKILL.md` frontmatter — "Implement tasks from an OpenSpec change" | Agent 执行时展示 "OpenSpec" |
| CLI description | `corgispec --help` — "Unified CLI for OpenSpec workflow" | 终端帮助文本显示 "OpenSpec" |
| 插件市场 | `.codex-plugin/plugin.json` — `"displayName": "CorgiSpec - OpenSpec GitFlow"` | Codex/Claude 插件列表显示混用命名 |
| 资产模板 | `packages/corgispec/assets/` — 安装源模板含 "OpenSpec" | 每次 `corgi-install` 把 "OpenSpec" 重新写入目标项目 |
| 文档 | `AGENTS.md`, README, wiki pages, 对外文章 | 用户阅读时看到混用命名 |

用户在 OpenCode 中执行 `/corgi-install` 时，命令面板和 Skill 执行输出仍显示 "OpenSpec"，造成品牌混淆。更严重的是，`packages/corgispec/assets/` 中的源模板未被考虑——即使改了部署文件，下一次 `corgi-install` 会重新引入 "OpenSpec" 文本。

## Scope Definition

### 替换规则

- **品牌文本** `"OpenSpec"` → `"Corgi"`（大小写敏感，仅匹配大写 O+S）
- **目录路径** `openspec/` → **保留不变**
- **Code 标识符**（如 `OpenSpecConfig` 接口名、`initializeOpenSpec()` 函数名）→ **不改**（属于代码重构，非品牌问题）

### 需要替换的（品牌文本 "OpenSpec"）

| # | 类别 | 文件数 | 行数（估） | 说明 |
|---|------|--------|-----------|------|
| 1 | 命令 dispatch 文件 | 4 | ~8 | `.opencode/commands/corgi-*.md` + `.claude/commands/corgi/*.md` 的 description + 正文 |
| 2 | 🔴 **资产源模板** | **~35** | ~50 | `packages/corgispec/assets/` — 命令模板(17: Claude 7 + OpenCode 10) + Skill 模板(17) + meta.json(1)。**不改则每次 install 重新引入 OpenSpec** |
| 3 | Skill SKILL.md | 21 | ~40 | 三平台 × 7 个 skill 的 frontmatter + 正文 |
| 4 | CLI 源码 | 8 | ~15 | `corgispec.ts` description、bootstrap/doctor/init 输出文案 |
| 5 | 🔴 **小写 `opsx` 残余（初审遗漏）** | ~15 | ~30 | SKILL.md 正文中的 `## Active opsx Change`、`每 10 个 opsx 会话` 等小写品牌残余。和 `OPSX` 不同——`opsx` 是流程名词而非命令前缀。验证 grep `"OpenSpec"`（大写 O+S）会全部漏掉 |
| 6 | skill.meta.json | 3 | ~3 | description 字段 |
| 7 | 测试文件 | 2 | ~5 | `init.test.ts`、`doctor.test.ts` — CLI 输出变更后断言会失败 |
| 8 | package.json | 1 | ~2 | npm package description（对外可见）；keywords 中的 `"openspec"` 需评估 |
| 9 | 插件 marketplace JSON | 3 | ~6 | `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json`、`.agents/plugins/marketplace.json` |
| 10 | README | 2 | ~20 | `README.md` + `README.zh-TW.md`（项目门面） |
| 11 | 文档 | 20 | ~60 | docs/ (12) + wiki/ (8) + 根配置 (2: AGENTS.md, INSTALL.md) |
| 12 | memory/MEMORY.md | 1 | ~2 | 项目描述中的 "OpenSpec GitFlow" |
| 13 | 🟡 **其他遗漏文件（agent review 发现）** | 2 | ~3 | `tools/ds-skills/tests/fixtures/valid-atom/SKILL.md`（"Resolve OpenSpec project configuration"）+ `openspec/.opsx-install-report.md`（文件名含 `opsx`，建议删除） |

**总计**：约 **90-95 个文件**，~210+ 处替换。（初审估计 54 个文件，经 agent review 发现遗漏 ~40 个文件，含小写 `opsx` 引用和 `author:` 字段。）

### 🔴 关键：资产源模板（assets/）

这是初审遗漏的最严重类别。`packages/corgispec/assets/` 是 `corgispec install` 和 `corgispec bootstrap` 复制到目标项目的**源模板**。包含：

```
packages/corgispec/assets/
├── commands/
│   ├── opencode/corgi-apply.md      ← 含 "OpenSpec change"
│   ├── opencode/corgi-install.md    ← 含 "OpenSpec GitFlow assets"
│   ├── claude/corgi/apply.md        ← 含 "OpenSpec change" + name: "OPSX: Apply"
│   └── claude/corgi/install.md      ← 含 "OpenSpec GitFlow assets" + name: "OPSX: Install"
├── skills/
│   ├── molecules/corgispec-apply-change/SKILL.md
│   ├── molecules/corgispec-explore/SKILL.md
│   ├── molecules/corgispec-gh-apply/SKILL.md
│   ├── molecules/corgispec-gh-explore/SKILL.md
│   ├── molecules/corgispec-install/SKILL.md
│   ├── molecules/corgispec-memory-migrate/SKILL.md
│   ├── molecules/corgispec-install/skill.meta.json
│   └── atoms/corgispec-memory-init/SKILL.md
└── schemas/{gitlab,github}-tracked/**  ← 无 OpenSpec 文本，无需改动
```

**不改这些文件 = 每次 `corgispec install` 把 "OpenSpec" 重新写入目标项目，品牌替换全部白做。**

### 不替换的（目录路径约定 `openspec/`）

`openspec/` 是项目目录结构的约定名称（类似 `.git/`、`node_modules/`），不是品牌文本：

```
openspec/config.yaml       ← 目录约定，不改
openspec/changes/          ← 目录约定，不改
openspec/schemas/          ← 目录约定，不改
openspec/specs/            ← 目录约定，不改
openspec/.corgi-install.json  ← 目录约定，不改
```

**理由**：
1. `openspec/` 出现在 200+ 个文件中，改名是结构性变更，非品牌问题
2. `openspec/` 是跨项目的工作流标准目录名（类比 `.github/`、`.gitlab/`），改名会破坏与外部工具链的兼容性
3. 与本次品牌一致性目标无关

### 不替换的（Code 标识符）

以下 TypeScript 源码中的标识符是代码命名，不是品牌文本，不在本次范围：

| 文件 | 标识符 | 类型 |
|------|--------|------|
| `lib/config.ts` | `OpenSpecConfig` interface | 接口名 |
| `commands/init.ts` | `InitializeOpenSpecOptions` | 类型别名 |
| `commands/init.ts` | `initializeOpenSpec()` | 函数名 |
| `lib/config.ts` | JSDoc `"OpenSpec config"` | 开发者文档（可选改） |

### 不需要替换的（已正确使用 Corgi 命名的）

- `corgispec` CLI 工具名 — 已正确
- `/corgi-*` 斜杠命令名 — 已正确
- `corgispec-*` Skill 目录名 — 已正确
- `packages/corgispec/` 包名 — 已正确

## 命名一致性问题

Agent review 发现提议的 "Corgi" 品牌与现存多处命名存在冲突，需在替换时统一决策：

### 冲突矩阵

| 现存名称 | 出现位置 | 与 "Corgi" 的关系 | 建议处理 |
|----------|---------|-------------------|---------|
| `"CorgiSpec"` | 3 个插件 `displayName` | 多出 "Spec" 后缀 | 改为 `"Corgi"`，与决策一致 |
| `"Coding Corgi Flow"` | README 标题 | 产品线全名 | 保留作为产品全名，简化引用用 "Corgi" |
| `"Corgi Flow"` | README 正文 | 产品简称 | 保留，与 "Corgi" 品牌不冲突 |
| `"OPSX: *"` | 6 个 Claude 命令 `name` 字段 | OpenSpec X 缩写残余 | 改为 `"Corgi: *"` |
| `"CorgiSpec - OpenSpec GitFlow"` | `.agents/plugins/marketplace.json` | 混用 | 改为 `"Corgi"` |

### `OPSX` 缩写残余（含小写 `opsx`）

**大写** — `.claude/commands/corgi/*.md` 中 6 个文件的 `name` frontmatter 使用 `"OPSX: XXX"`：

```
apply.md:    name: "OPSX: Apply"
install.md:  name: "OPSX: Install"
propose.md:  name: "OPSX: Propose"
review.md:   name: "OPSX: Review"
archive.md:  name: "OPSX: Archive"
explore.md:  name: "OPSX: Explore"
```

需全部改为 `"Corgi: XXX"`，包括对应的 assets/ 源模板。

**小写** — SKILL.md 正文中存在 ~30+ 处小写 `opsx` 引用（初审遗漏），分布在 `corgispec-memory-init`、`corgispec-memory-extract`、`corgispec-apply-change`、`corgispec-lint` 四个 skill 的正文中：

```
## Active opsx Change          → ## Active corgi Change
opsx 应用会话期间累积的陷阱    → corgi 应用会话期间累积的陷阱
### opsx Apply → 长期记忆      → ### corgi Apply → 长期记忆
每 10 个 opsx 会话             → 每 10 个 corgi 会话
将 Active opsx Change 设为...  → 将 Active corgi Change 设为...
```

小写 `opsx` 是流程名词（非命令前缀），在 Agent 运行时作为工作流阶段描述出现。**验证 grep `"OpenSpec"` (大写 O+S) 会全部漏掉这些引用**，需单独 `grep -rni "opsx"` 检查。

### `metadata.author: "openspec"`（小写）

SKILL.md frontmatter 中的 `metadata.author: "openspec"` 是小写，case-sensitive grep 会漏掉。需单独搜 `author:` 字段，替换为 `"corgispec"`（匹配 CLI 工具名）。

### 外部归属引用（不可改）

以下是对上游项目 Fission-AI/OpenSpec 的真实引用，**必须保留**：
- README 中 "OpenSpec 的社区扩展"、"原生 OpenSpec vs. Corgi Flow"
- 指向 `https://github.com/Fission-AI/OpenSpec` 的链接
- 对外文章中标明 "基于 OpenSpec 构建" 的归属声明

区分标准：如果 "OpenSpec" 指的**是 Fission AI 的项目** → 保留；如果指**本项目/本工作流** → 替换为 "Corgi"。

## 特殊情况处理

| 原文                                                                 | 处理方式                                 | 原因                                                                               |
| ------------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------- |
| `"OPSX: Install"` (Claude 命令 name)                                 | → `"Corgi: Install"`                 | OPSX = OpenSpec X 缩写残余                                                           |
| `opsx` (小写, SKILL.md 正文)                                           | → `corgi`                            | 小写流程名词残余，初审遗漏。grep `"OpenSpec"` 会漏掉                                              |
| `"Unified CLI for OpenSpec workflow"` (corgispec.ts, package.json) | → `"Unified CLI for Corgi workflow"` | CLI + npm 自身描述                                                                   |
| `"OpenSpec GitFlow"`                                               | → `"Corgi GitFlow"`                  | 组合品牌名                                                                            |
| `"OpenSpec Awareness"` (explore skill heading)                     | → `"Corgi Awareness"`                | Skill 章节标题，指本工作流系统                                                               |
| `"OpenSpec managed files"` (install skill legacy message)          | → `"Corgi managed files"`            | Skill 运行时消息，指本项目管理文件                                                             |
| `metadata.author: "openspec"` (小写)                                 | → `"corgispec"`                      | 小写 frontmatter 值，case-sensitive grep 会漏掉                                         |
| `"openspec/..."` (目录路径)                                            | **保留不变**                             | 目录约定，非品牌文本                                                                       |
| `"openspec-llm-memory"` (文件名)                                      | **保留不变**                             | 文件名约定，历史文档标识                                                                     |
| `"OpenSpec"` 指 Fission AI 上游项目                                     | **保留不变**                             | 外部归属，非本项目品牌                                                                      |
| `OpenSpecConfig` / `initializeOpenSpec()` (TS 标识符)                 | **保留不变**                             | 代码命名，非品牌文本                                                                       |
| `"keywords": ["openspec", ...]` (package.json)                     | **待定**                               | npm 关键词：改则丢失可发现性，不改则留 "openspec" 残余。建议删除并用 `"corgispec"` + `"corgi-workflow"` 替代 |
| `.codex/skills.backup/` vs `.codex/skills/`                        | **先覆盖同步，再替换**                        | backup 目录内容与主目录不一致（缺失 Context Gate 模式 + 旧版 CLI 引用），直接用 `cp -r` 从权威源覆盖            |
| `openspec/.opsx-install-report.md`                                 | **删除**                               | 文件名含 `opsx`，内容为可重生成的安装报告                                                         |
| `tools/ds-skills/tests/fixtures/valid-atom/SKILL.md`               | → `"Corgi"`                          | 测试固件中的品牌文本，初审遗漏                                                                  |

## Decision

**全面替换品牌文本 "OpenSpec" → "Corgi"，保留 `openspec/` 目录路径和外部归属引用不变。**

执行原则：
1. **品牌文本替换**：所有 description、frontmatter、CLI 输出、文档正文中的 "OpenSpec" → "Corgi"
2. **目录路径保留**：`openspec/config.yaml`、`openspec/changes/` 等路径引用保持不变
3. **文件名保留**：`openspec-llm-memory.md` 等历史文档文件名中的 "openspec" 保留
4. **Code 标识符保留**：`OpenSpecConfig`、`initializeOpenSpec()` 等 TS 标识符不改
5. **外部归属保留**：指向 Fission-AI/OpenSpec 的引用和链接不变
6. **资产源模板必改**：`packages/corgispec/assets/` 必须同步替换，否则每次 install 重新引入 "OpenSpec"
7. **三平台同步**：`.opencode/skills/`、`.claude/skills/`、`.codex/skills.backup/` 同时替换
8. **先记录决策，后执行**：本决策文档作为变更依据，实际替换在审批后单独执行

## Implementation Plan

**关键顺序修正**（来自 agent review）：Phase 1(命令)、Phase 3(技能)、Phase 2a(资产模板) 存在镜像依赖关系。若分开执行，在时间窗口内运行 `corgispec install` 会将混合品牌文件写入目标项目。**因此 Phase 1+3+2a 必须合并为单一原子提交流程，不可拆分。**

分 3 个递进阶段：

### Phase 0: 前置准备

- [ ] 决定 `package.json` keywords 中 `"openspec"` 的处理策略（建议：删除，替换为 `"corgispec"` + `"corgi-workflow"`）
- [ ] 创建回滚标签：`git tag pre-rebrand-v0.1.1`（agent review 新增强制要求）
- [ ] 将 `.codex/skills.backup/` 用 `cp -r` 从 `.opencode/skills/` 完整覆盖（当前 backup 目录不仅品牌过期，还包含旧版 CLI 引用如 `openspec list --json`，不可增量编辑）

### Phase 1: 原子提交单元（阻断性依赖，不可拆分）🔒

**包含：命令 dispatch 文件 + Skill 定义文件 + 资产源模板 + 小写 `opsx` 残余**

| 子单元 | 文件数 | 改动内容 |
|--------|--------|---------|
| 1a. 命令 dispatch | 6 | `name: "OPSX: *"` → `"Corgi: *"` + description/正文 "OpenSpec" → "Corgi" |
| 1b. Skill 定义 | 21 SKILL.md + 3 meta.json | frontmatter description + 正文 "OpenSpec" → "Corgi" + `author: openspec` → `corgispec` |
| 1c. 小写 `opsx` | ~15 SKILL.md | `opsx` → `corgi`（`## Active opsx Change`、`每 10 个 opsx 会话` 等 ~30 处，agent review 新发现） |
| 1d. 资产源模板 | ~35 | 与 1a/1b/1c 的对应文件镜像一致替换 + `author: openspec` → `corgispec` |

**必须作为单个 commit 完成！** 任何子单元未完成时运行 `corgispec install` 都会导致目标项目收到混合品牌文件。

**验证**：（Phase 1 完成后立即执行）
- `grep -rni "OpenSpec\|OPSX\|opsx" .opencode/commands/ .claude/commands/` → 零结果
- `grep -rni "OpenSpec\|OPSX\|opsx" packages/corgispec/assets/` → 零结果
- `grep -rn "OpenSpec" --include="SKILL.md" .opencode/skills/ .claude/skills/ .codex/skills.backup/` → 零结果
- `grep -rni "author:.*openspec" --include="SKILL.md" .opencode/skills/ .claude/skills/` → 零结果
- `grep -rni "opsx" --include="SKILL.md" .opencode/skills/ .claude/skills/` → 零结果
- `corgispec install --mode fresh --path /tmp/test-rebrand` → 目标文件不含 "OpenSpec" / "OPSX" / "opsx"

### Phase 2: CLI 源码 + 测试 + 文档/插件配置（可并行）

**2a. CLI 源码 + 测试（编译器安全网）：**
- 8 个 .ts 文件（只改字符串字面量，不动标识符和 `openspec/` 路径）
- 2 个测试文件同步改断言字符串（**必须原子化：CLI 改动和测试改动在同一个 commit**）
- **验证**：`cd packages/corgispec && npm test` → 全部通过

**2b. 文档、插件配置、README：**
- 插件 marketplace JSONs (3)：displayName + description
- README (2)：正文中的品牌引用（**保留外部归属**，逐句人工判断）
- 文档 (~22)：docs/ + wiki/ + AGENTS.md + INSTALL.md
- memory/MEMORY.md (1)
- `tools/ds-skills/tests/fixtures/valid-atom/SKILL.md` (1)（agent review 新发现）
- 删除 `openspec/.opsx-install-report.md`（agent review 新发现）
- **验证**：`grep -rni "OpenSpec\|OPSX\|opsx" --include="*.md" --include="*.json" .` (排除 openspec/ 路径和外部归属后 → 零品牌引用)

Phase 2a 和 2b 可完全并行执行。

### Phase 3: 最终验证

替换完成后全量验证 10 项检查（见下方 Verification 章节）。

## Risk Assessment

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| `openspec/` 路径误替换 | 🔴 高 | 大小写区分：替换 "OpenSpec"（大写 O+S），不动 "openspec/"（小写）。每阶段后用 `grep` 验证 |
| assets/ 源模板遗忘 | 🔴 高 | Phase 1 原子单元包含 ~35 个 asset 文件（agent review 修正：初审 12→~35）。用 `corgispec install --mode fresh` 实测验证 |
| Phase 1/3/2a 时间窗口损坏 | 🔴 高 | Phase 1(命令)+3(技能)+2a(资产) 合并为原子提交，消除 `corgispec install` 中途读取不一致模板的风险（agent review 新发现） |
| 无回滚策略 | 🔴 高 | Phase 0 创建 `pre-rebrand-v0.1.1` tag；Phase 1 原子提交后可单步 `git revert`；Phase 2/4 独立可逆（agent review 新发现） |
| 小写 `opsx` 残余被漏掉 | 🔴 高 | 单独 `grep -rni "opsx"` 搜索，不依赖 case-sensitive "OpenSpec" 搜索。Phase 1 原子单元包含小写 opsx 替换（agent review 新发现） |
| 资产模板与部署文件不一致 | 🟡 中 | assets/ 和 .opencode/commands/ / .claude/commands/ + .opencode/skills/ 必须镜像一致，diff 验证 |
| Skill 文本改动影响 Agent 行为 | 🟡 中 | 仅改品牌词（"OpenSpec change" → "Corgi change"），不改指令语义或逻辑结构 |
| 三平台 skill 文件不同步 | 🟡 中 | Phase 1 三平台同时改；Phase 0 先用 `cp -r` 覆盖 `.codex/skills.backup/`（不是增量编辑，因为 backup 还含旧版 CLI 引用） |
| 测试断言因 CLI 文案变更而失败 | 🟡 中 | Phase 2a 包含测试文件更新；CLI 改动和测试改动必须在同一个 commit（agent review 建议） |
| 小写 `author: openspec` 被漏掉 | 🟡 中 | 单独 grep `author:` frontmatter 字段，不依赖 case-sensitive "OpenSpec" 搜索 |
| 误改对 Fission-AI/OpenSpec 的外部归属 | 🟡 中 | README 和对外文章中「指上游项目」的 "OpenSpec" 手动排除 |
| 无 CI 自动化安全网 | 🟡 中 | `AGENTS.md` 确认无 CI workflows。80+ 文件全人工验证。Phase 3 的 10 项检查清单作为唯一护栏（agent review 新发现） |
| MaliciousCorgi 品牌污染 | 🟡 中 | 2026年1月 VS Code 恶意扩展攻击 "MaliciousCorgi" 盗窃 150 万开发者代码。"Corgi" 词在 VS Code 生态中有负面安全关联。在 Alternatives Considered 中记录此风险（agent review 新发现） |
| 文档中历史引用混乱 | 🟢 低 | 活跃文档改品牌文本，历史研究/归档文档保留原引用 |
| package.json keywords 取舍 | 🟢 低 | 单独决策：npm 可发现性 vs 品牌一致性。建议删除 `"openspec"` 并替换为 `"corgispec"` + `"corgi-workflow"` |
| `feat/openspec-llm-memory` 分支名 | 🟢 低 | 历史分支名保留不变，记录为预期情况（agent review 新发现） |

## Alternatives Considered

- **只改命令描述**：改动量最小，但 Skill 执行时 Agent 仍输出 "OpenSpec"，品牌不一致未根治。拒绝。
- **改成 "CorgiSpec"**：保留 "Spec" 后缀体现规格化定位。但插件 displayName 已是 "CorgiSpec"，README 是 "Coding Corgi Flow"，命令是 `/corgi-*`，再加一个品牌名造成 4 种命名并存。拒绝。
- **改成 "Corgi Flow"**：与 README 简称一致。但 CLI help 和 Skill 描述中 "Corgi Flow workflow" 冗余。拒绝。
- **连目录一起改 `openspec/` → `corgi/`**：影响 200+ 个文件，破坏与已有项目的兼容性。属于未来独立迁移项目，与本次品牌文本替换分开。拒绝。
- **改用非 "Corgi" 的其他品牌名**：考虑过但不现实——`corgispec` CLI 和 `/corgi-*` 命令已部署使用。需注意 "Corgi" 的品牌外部风险：2026 年 1 月的 "MaliciousCorgi" VS Code 供应链攻击事件在开发者社区中建立了负面关联；npm 上已有 `corgi`（系统监控）、`corgi-cli`（微信小程序 CLI）等同名工具。这些风险不严重到需要再次改名，但应在沟通中正视。

## Consequences

### 正面
- 用户在 OpenCode/Claude Code 中看到一致的 "Corgi" 品牌
- 命令名 `/corgi-*`、Skill 名 `corgispec-*`、描述文本 "Corgi" 三者一致
- `corgispec install` 不再把 "OpenSpec" 文本写入目标项目
- 消除新用户的认知混淆（"为什么 /corgi-install 装的是 OpenSpec？"）

### 负面
- 90-95 个文件的批量修改有协调成本（agent review 修正：初审 80-85 → 90-95）
- 三平台 skill 同步增加维护负担（但这是已有义务，非新增）
- `.codex/skills.backup/` 需先用 `cp -r` 完整覆盖（不只是增量编辑），增加前置步骤
- 对外已发布的文章（知乎等）中引用 "OpenSpec" 需同步更新
- `package.json` keywords 中的 `"openspec"` 取舍需额外决策
- 外部品牌风险：MaliciousCorgi 安全事件关联、`corgi-cli` 同名竞品（已在 Alternatives Considered 中记录）
- `openspec/` 目录永久不改为 `corgi/`，命令 `/corgi-*` 操作 `openspec/` 目录的认知脱节无法消除

### 沟通计划（agent review 新增）

- [ ] **CHANGELOG**：在 `packages/corgispec/CHANGELOG.md` 中记录 "OpenSpec" → "Corgi" 品牌变更
- [ ] **npm 版本**：作为 semver 次版本升级发布（0.1.x → 0.2.0），标注品牌重塑
- [ ] **知乎文章**：同步更新已发布文章中的品牌引用和 #hashtags
- [ ] **FAQ**：在 README 或 wiki 中添加解释，说明为什么命令是 `/corgi-*` 但目录是 `openspec/`

### 不作为的风险
- 品牌分裂持续，每个新用户都会产生 "OpenSpec vs Corgi" 的困惑
- 随着 `/corgi-*` 命令使用量增长，OpenSpec 残余引用显得越来越突兀
- `corgispec install` 持续把 "OpenSpec" 写入新项目，问题扩散

## Verification

替换完成后需验证（agent review 新增小写 `opsx` 和 `author:` 检查）：

1. **命令文件**：`grep -rni "OpenSpec\|OPSX\|opsx" --include="*.md" .opencode/commands/ .claude/commands/` → 零结果
2. **资产模板**：`grep -rni "OpenSpec\|OPSX\|opsx" --include="*.md" --include="*.json" packages/corgispec/assets/` → 零结果
3. **Skill 文件（品牌文本）**：`grep -rn "OpenSpec" --include="SKILL.md" .opencode/skills/ .claude/skills/ .codex/skills.backup/` → 零结果
4. **Skill 文件（小写 opsx）**：`grep -rni "opsx" --include="SKILL.md" .opencode/skills/ .claude/skills/ .codex/skills.backup/` → 零结果
5. **小写 author**：`grep -rni "author:.*openspec" --include="SKILL.md" .opencode/skills/ .claude/skills/` → 零结果（全部为 `corgispec`）
6. **CLI 源码**：`grep -rn "OpenSpec" packages/corgispec/src/` → 零结果（注意大写 O+S，不动 `openspec/` 路径）
7. **CLI 输出**：`corgispec --help` 输出包含 "Corgi" 而非 "OpenSpec"
8. **测试通过**：`cd packages/corgispec && npm test` → 全部通过
9. **安装实测**：`corgispec install --mode fresh --path /tmp/test-project`，检查目标文件不含 "OpenSpec" / "OPSX" / "opsx"
10. **lint 通过**：`corgispec lint` 无错误
11. **路径完整性**：`grep -rn "openspec/" packages/corgispec/src/` 路径引用全部正常（验证未误删路径）

---

## Related
- [[hooks-augment-not-replace-skills|Hooks Augment Skills, Not Replace Them]] — 同日相关架构决策
- [[wiki/architecture/overview|Architecture Overview]]
- [[AGENTS.md]]
