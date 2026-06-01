---
type: wiki
updated: 2026-05-29
source: "Repository-local analysis: .opencode/commands/corgi-review.md, .opencode/commands/corgi-verify.md, .opencode/commands/corgi-archive.md, .opencode/skills/molecules/corgispec-review/SKILL.md, .opencode/skills/molecules/corgispec-verify/SKILL.md, .opencode/skills/molecules/corgispec-archive-change/SKILL.md, docs/superpowers/specs/2026-04-21-unified-router-workflow-design.md, docs/superpowers/specs/2026-04-22-opsx-verify-and-routing-upgrade-design.md"
tags: [research, qa, archive, review, evidence]
---

# 预归档 Human QA 技能研究

> 目标：在 `/corgi-archive` 之前插入一个“像人类 QA 工程师一样实际走流程”的独立技能，专门做真实入口验证、截图/录屏/日志沉淀，并把结果写回 parent backlog card。

## 结论

**推荐方案：新增一个独立的 pre-archive human QA 阶段。**

- 放在 **`review` 之后、`archive` 之前**
- 负责 **真实使用路径验证**，不是自动测试
- 产出 **可读的证据包**：截图、调用结果、步骤记录、失败点
- 把结果 **写回 parent backlog card**，必要时也写入 change 本地 QA artifact

**不要**把它塞进：

- `verify`：这里应保持自动化、无人工 gate
- `review`：这里已经是 approve / reject / discuss 的决策 gate
- `archive`：这里应只做收尾、知识沉淀和关闭，不应承载新的人工 walkthrough

## 仓库证据

### 1) `verify` 是自动化门，不适合做人类 QA

`.opencode/skills/molecules/corgispec-verify/SKILL.md` 明确写了：

- verify 是自动化
- 不能问人
- 不能加 Playwright/UI 截图
- 目标是 tests / spec coverage / lint / build

**推论**：人类式 walkthrough QA 应该是独立阶段，不应复用 verify。

### 2) `review` 已经是决策门，不是 walkthrough 门

`.opencode/skills/molecules/corgispec-review/SKILL.md` / `corgispec-gh-review` 已经承担：

- quality checks
- review report
- 人类 approve / reject / discuss
- 之后再推进状态

**推论**：如果把“真实使用测试”塞进 review，会把“证据收集”和“人类决策”再次搅在一起。

### 3) `archive` 现在是收尾门

`.opencode/skills/molecules/corgispec-archive-change/SKILL.md` 与 `corgispec-gh-archive` 主要做：

- 归档 change
- 关闭/移动 issue
- 同步 delta spec
- 触发 memory extract

**推论**：QA 如果放进 archive，archive 就会变成“最后一次测试 + 收尾”的混合阶段，边界会变脏。

### 4) 现有设计已经支持“证据收集 ≠ 决策”

`docs/superpowers/specs/2026-04-22-opsx-verify-and-routing-upgrade-design.md` 已经把：

- verify 定义成 evidence-only
- review 定义成 decision-only
- browser-aware verification 放在 verify

`docs/superpowers/specs/2026-04-21-unified-router-workflow-design.md` 也强调：

- review 要收集证据但不应再混入核心工作
- human gate 要显式、分阶段

**推论**：新的 human QA 最适合成为一段新的 evidence gate，而不是改写旧 gate。

## 推荐实现形状

### 命名

优先建议：

- wrapper：`corgi-pre-archive-qa`
- skill：`corgispec-pre-archive-qa`

如果想更强调“人类走查”语义，也可以叫：

- `corgi-human-qa`
- `corgispec-human-qa`

**建议选 `pre-archive-qa`**，因为它直接说明位置，避免和 `review` 混淆。

### 分层

推荐保持和现有架构一致：

1. **Command wrapper**
   - 读取 `openspec/config.yaml`
   - 解析 schema / isolation
   - 分发到平台实现

2. **QA skill core**
   - 收集人工 walkthrough 证据
   - 记录截图/日志/输入输出
   - 生成可贴到 issue 的报告

3. **Platform adapter**
   - GitLab / GitHub 只处理 issue comment / attachment 差异
   - 不把业务 QA 逻辑散进平台层

### 结果输出

建议至少产出两份东西：

- `qa-report.md`（或类似本地 artifact）
- parent backlog card 上的富文本评论

评论内容建议固定为：

- 目标场景
- 实际走过的步骤
- 截图 / 链接 / 附件
- 观察到的结果
- 问题与严重度
- 是否允许归档

## QA 证据合同

不同类型的变更，走查方式应不同：

| 变更类型 | 人类 QA 方式 | 证据 |
|---|---|---|
| Dashboard / UI | 打开真实页面，按用户路径点一遍 | 截图、页面状态、异常提示 |
| Backend logic | 从 root function 或真实入口调用到目标逻辑 | 输入 / 输出、调用链、返回值 |
| API / CLI | 从真实命令或真实 API 入口跑一遍 | stdout / stderr、状态码、请求响应 |
| 混合型 | UI + backend 联合走查 | 截图 + 调用记录 + 结果摘要 |

### 最低要求

- 不是“测试脚本跑过了”就算
- 需要能看出“人实际怎么用的”
- 需要能看出“哪里出错、怎么复现、是否可归档”

## 与 archive 的耦合方式

建议 archive 只接受两种状态之一：

1. **QA passed**
2. **QA skipped with explicit reason**（仅限纯后端 / 无交互 surface 的极少数情况）

如果 QA failed：

- 不归档
- 把失败点写回 parent backlog card
- 生成后续修复项
- 重新走 apply / review / qa

## 不建议的做法

- 把 human QA 塞进 verify
- 把 walkthrough 当成 review 的附带动作
- 只贴测试输出，不贴人工证据
- 只在 archive 时临时补截图
- 让 QA 变成“看一眼就算”

## 结论摘要

**最稳的实现是：**

`apply -> review -> pre-archive human QA -> archive`

其中：

- `review` 负责“要不要继续”
- `pre-archive human QA` 负责“像真实用户一样走没走通”
- `archive` 负责“收尾并沉淀”

这三个职责应该分开。
