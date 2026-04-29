# OpenSpec GitHub Zhihu Publish Kit

## 备选标题

1. `OpenSpec 落地 GitHub：我们如何把 Spec、Issue、Review 和 Git 工作流接成一条线`
2. `不只生成 Spec：OpenSpec 如何真正进入 GitHub Issue、Review 与日常开发流程`
3. `从 Proposal 到 Archive：一个面向 GitHub 的 OpenSpec 工程工作流实践`
4. `给 OpenSpec 补上 GitHub 工作流：Issue 跟踪、分组执行与可复用 Skills`
5. `AI 辅助开发不该停在文档：我们如何基于 OpenSpec 搭出 GitHub 工作流`

## 推荐副标题

`当 spec 能持续流入 issue、apply、review 与 archive，AI workflow 才真正开始像工程流程。`

## 推荐摘要

很多团队已经能用 AI 生成 proposal、spec、design 和 tasks，真正的难点却是这些产物常常停在本地，进不了 GitHub 的 issue、review 与执行节奏。本文介绍我们如何以 OpenSpec 为底座，补齐 GitHub / Git 工作流，并用可复用 skills 减少重复劳动。

## 封面图建议

- 封面标题文案：`把 OpenSpec 真正接进 GitHub 工作流`
- 封面视觉方向：左侧放文档产物图标（proposal / spec / design / tasks），右侧放 GitHub Issues 与流程箭头，中间突出 `Review Gate` 或 `Apply -> Review -> Archive` 的闭环感。

## 配图建议

### 图 1：从 OpenSpec 文档，到 GitHub 执行闭环

- Caption：`从 OpenSpec 文档，到 GitHub 执行闭环`
- Figure note：`这张图对应文章最核心的主张：proposal、spec、design、tasks 不应停留在本地文档，而是继续进入 GitHub Issues 跟踪，并沿着 /opsx-apply、/opsx-review、/opsx-archive 形成可执行的工程节奏。`
- 画面建议：左到右流程图，依次展示 `/opsx-propose` -> `proposal/spec/design/tasks` -> `GitHub Issues（parent + child issues）` -> `/opsx-apply` -> `Task Group 完成？` -> `/opsx-review` -> `Approved?` -> 返回下一组或进入 `/opsx-archive`；保留 `Rejected -> Fix tasks added -> /opsx-apply` 的回路。

### 图 2：OpenSpec 底座之上，补的是 GitHub 工作流胶水

- Caption：`OpenSpec 底座之上，补的是 GitHub 工作流胶水`
- Figure note：`这张图适合把文章中间那张对照表做成更易读的视觉版本：OpenSpec 已经解决 change artifacts；这次补上的，是 issue 同步、checkpoint 式 apply、交互式 review、worktree 隔离和可组合 skills。`
- 画面建议：上下两层或左右两列。第一层是 `OpenSpec 基础层`，标出 `proposal / spec / design / tasks`；第二层是 `GitHub-friendly workflow glue`，标出 `GitHub issue sync`、`checkpoint-based apply`、`interactive review gate`、`git worktree isolation`、`reusable skill hierarchy`。旁边加一句小字：`Project 可作为可视化视图，但不是当前跟踪核心`。

### 图 3：把能力拆成 Atoms / Molecules / Compounds，流程才更容易复用

- Caption：`把能力拆成 Atoms / Molecules / Compounds，流程才更容易复用`
- Figure note：`这张图服务于“减少重复劳动”的论点。重点不是抽象概念本身，而是说明复合工作流不必每次从头拼装；同一套能力结构可以反复用于不同 change。`
- 画面建议：三层结构图或金字塔。底层是 `Atoms`，标注“单一用途、边界清晰”；中层是 `Molecules`，标注“2-10 个原子能力组成显式工作流”；顶层是 `Compounds`，标注“多个分子流程组成高层 playbook”。右下角可以放一个小例子：`JWT + refresh token change` 复用同一套流程能力。

## 发布备注

- 文章里的 Mermaid 代码块更适合作为源图，不建议直接把代码块原样发到知乎。
- 如果只保留两张图，优先保留“主流程闭环图”和“能力补齐对照图”。
- 全文不要把 GitHub Project 说成当前系统核心；更准确的说法仍然是：本地 artifacts、GitHub Issues、labels 和 `gh` CLI 共同构成当前跟踪路径。
