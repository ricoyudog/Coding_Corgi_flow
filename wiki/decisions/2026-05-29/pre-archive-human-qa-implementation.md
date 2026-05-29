---
type: wiki
updated: 2026-05-29
source: "[[wiki/research/2026-05-29/pre-archive-human-qa|research: pre-archive human QA]]"
status: proposed
tags: [decision, implementation-plan, human-qa, archive, workflow, skill-graph-2.0]
---

# Decision: Human QA 阶段实现计划（Skill Graph 2.0）

> 基于 [[wiki/research/2026-05-29/pre-archive-human-qa|研究结论]] 与对 QA 专业方法论（SBTM、HTSM、Risk-Based Testing、Test Tours）的调研，在 `review` 和 `archive` 之间插入一个由 **Molecule + 6 Atoms** 组成的 Human QA 阶段。
>
> `apply → review → human QA → archive`

## 决策记录

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 命名 | `/corgi-human-qa` + `corgispec-human-qa` | 强调"人类走查"语义，和 `review` 区隔清晰 |
| Skill Graph 架构 | **Molecule → Atoms** | 1 个 molecule 做 classification routing，6 个 atoms 做类型专项 walkthrough。符合 Skill Graph 2.0 层级规则 |
| Platform 变体 | 通用（`platform: universal`） | 像 `verify` 一样一套逻辑，平台差异仅体现在 tracker 评论发布 |
| QA 门控 | 可选门（passed / failed / skipped with reason） | 绝大多数场景须执行；极少数纯 infra/config 变更允许显式跳过 |
| 实施节奏 | 一期做完（本地 + tracker） | 同时实现 `qa-report.md` + GitLab/GitHub issue 评论发布 |
| Archive 耦合 | 读本地 `qa-report.md` | 符合 authoritative local state 原则 |
| QA 产出位置 | `openspec/changes/<name>/qa-report.md` | 和 tasks.md / specs 同级，随 change 一起归档 |

## Skill Graph 2.0 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│  /corgi-human-qa  (command wrapper — NOT a skill)                 │
│  Reads config.yaml → platform detection → dispatches to molecule  │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  corgispec-human-qa  (molecule — tier 2)                          │
│                                                                   │
│  Step 1: Select change + resolve worktree                         │
│  Step 2: Risk assessment (Complex/New/Critical/Changed heuristics) │
│  Step 3: Classify change type & route to atoms                    │
│  Step 4: Collect human test cases (conversational input/expected)  │
│  Step 5: Inject test cases into atoms → execute walkthroughs       │
│  Step 6: Assemble qa-report.md (SBTM debrief format)              │
│  Step 7: Post summary to tracker (glab/gh)                        │
│  Step 8: Gate output (passed / failed / skipped)                  │
└─────────────────────────────┬────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────────┐
          │                   │                       │
          ▼                   ▼                       ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│ qa-smoke (atom) │  │ qa-{type} (atom) │  │ qa-exploratory (atom)│
│ Always runs first│  │ Type-specific    │  │ Always runs last     │
│ 5-15 min sanity  │  │ walkthrough      │  │ SBTM 45-75 min       │
└──────────────────┘  └──────────────────┘  └──────────────────────┘
                              │
                              ▼ (gating in archive, not here)
┌──────────────────────────────────────────────────────────────────┐
│  corgispec-archive-change / corgispec-gh-archive (modified)       │
│  + new step: check qa-report.md status before archiving           │
│    - passed → continue                                            │
│    - skipped (with reason) → continue with note                   │
│    - failed / missing → STOP, refuse to archive                   │
└──────────────────────────────────────────────────────────────────┘
```

## Molecule 路由逻辑

Molecule 根据 change type 自动选择要调用的 atoms：

| Change Type | 检测条件 | 调用的 Atoms |
|-------------|---------|-------------|
| UI | `.tsx`, `.vue`, `.jsx`, `.html`, `.css`, `.scss` | smoke → **ui** → exploratory |
| Backend | `.py`, `.go`, `.rs`, `.java`（无 UI 文件） | smoke → **backend** → exploratory |
| API | REST/GraphQL endpoint 变更 | smoke → **api** → exploratory |
| CLI | CLI entry point 变更 | smoke → **cli** → exploratory |
| Full-stack | UI + Backend 同时变更 | smoke → **ui** → **api** → **backend** → exploratory |
| Database | Migration 文件（`.sql`, `alembic/`, `prisma/`） | smoke → **backend** → exploratory（注：database atom 为 Phase 2） |
| Config/Infra | YAML/TOML/Dockerfile/Terraform | smoke → exploratory（smoke 覆盖启动验证） |
| Mixed | 多类别混合 | 自动组合对应的 type-specific atoms |

**路由规则**：
- `qa-smoke` **始终最先执行**（"能启动吗？"是其他一切测试的前提）
- `qa-exploratory` **始终最后执行**（SBTM session 综合验证）
- Type-specific atoms 中间按需执行
- 同类型只执行一次（不重复调用）

## 实现任务

### Phase 1: 创建 Command Wrapper

**文件**: `.opencode/commands/corgi-human-qa.md`（新建）

参考 `corgi-verify.md` 的 wrapper 模式（platform-universal，不分子变体）：

- [ ] 1.1 读取 `openspec/config.yaml`，检查 `schema` 字段（用于确定 tracker CLI）
- [ ] 1.2 检查 isolation mode（worktree 支持）
- [ ] 1.3 分发到 `corgispec-human-qa` molecule（通用 skill）
- [ ] 1.4 透传用户输入
- [ ] 1.5 验证 postconditions：`qa-report.md` 存在、状态明确、所有被路由的 atom 证据齐全

---

### Phase 2: 创建 Molecule `corgispec-human-qa`

**文件**:
- `.opencode/skills/molecules/corgispec-human-qa/SKILL.md`（新建）
- `.opencode/skills/molecules/corgispec-human-qa/skill.meta.json`（新建）

**skill.meta.json**:
```json
{
  "slug": "corgispec-human-qa",
  "tier": "molecule",
  "version": "1.0.0",
  "description": "Human QA gate between review and archive — classifies change, routes to QA atoms, assembles evidence report",
  "depends_on": [
    "corgispec-qa-smoke",
    "corgispec-qa-ui",
    "corgispec-qa-backend",
    "corgispec-qa-api",
    "corgispec-qa-cli",
    "corgispec-qa-exploratory"
  ],
  "platform": "universal",
  "tags": ["lifecycle", "qa", "human-gate"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "molecules/corgispec-human-qa"
  }
}
```

#### Preconditions

- [ ] Change exists in `openspec/changes/<name>/`
- [ ] If tracked: `.gitlab.yaml` or `.github.yaml` exists
- [ ] If `isolation.mode: worktree`: worktree exists

#### Forbidden Actions

- NEVER auto-pass QA — evidence must be collected and visible
- NEVER skip walkthrough without explicit human reason
- NEVER fabricate screenshots, logs, or evidence
- NEVER implement fixes during QA
- NEVER change issue labels or workflow state（那是 archive 的职责）

#### Steps

**Step 1: Select change and resolve worktree**

复用与 verify / archive 一致的 change 发现逻辑：
- Context Gate 检查（session context 中是否已有 isolation.mode + worktree paths + branch）
- `openspec list --json`
- Worktree discovery（if isolation active）

**Step 2: Risk assessment（HTSM 启发式风险评估）**

在分类之前，对 change 进行快速风险评估，决定 QA 深度。评估使用 James Bach 的 Generic Risk Heuristics：

| 启发式 | 评估 | 权重 |
|--------|------|------|
| Complex | 变更涉及多少模块/文件？逻辑复杂度？ | 高复杂度 → +30% QA 深度 |
| New | 是否新增功能（从未存在过）？ | 全新功能 → +20% QA 深度 |
| Changed | 修改了什么？是否触及核心路径？ | 核心路径 → +30% QA 深度 |
| Critical | 失败影响？数据安全？收入？ | 关键路径 → +40% QA 深度 |
| Popular | 被多少用户/系统使用？ | 高使用频率 → +20% QA 深度 |
| Buggy | 此模块历史缺陷密度？ | 历史多 bug → +20% QA 深度 |

综合评分决定 exploratory session 深度（标准 45min → 高风险 75min）。

**Step 3: Classify change type & route to atoms**

读取 change 的 diff、spec 和 design，按路由表（见上文）确定需要调用的 atoms。

输出分类结果给用户确认：
```
## QA Classification

**Change:** <name>
**Type:** UI / Backend / API / CLI / Full-stack / Mixed
**Risk:** Low / Medium / High / Critical
**QA Atoms to execute:**
  1. qa-smoke (always)
  2. qa-ui (UI files detected: 12)
  3. qa-exploratory (45 min session)

Proceed with these atoms? (y/n/edit)
```

**Step 4: Collect human test cases（对话式收集 input/expected output）**

分类完成后、执行 atoms 之前，molecule 通过对话式交互收集人类指定的测试用例。

**对话协议**：

Molecule 发起：
```
## Human Test Cases

在自动走查之前，你有没有具体场景想让我验证？
如果有，告诉我：
  - 场景描述（想测什么？）
  - 输入数据（用什么数据？文件路径 / API payload / CLI 参数 / 用户操作？）
  - 期望输出（预期看到什么？）

可以一条一条说，也可以批量提供。输入 "done" 结束收集。
```

人类可以多种方式提供：
- **内联数据**：直接描述 input/output
- **文件路径**：指向 fixture JSON/YAML/CSV 文件
- **环境变量**：指定测试时需要的 env
- **API payload**：curl 命令或 JSON body
- **UI 操作序列**：点击路径描述

**结构化收集**（molecule 逐轮收集，直到人类说 done）：

每轮对话 molecule 追问以消除歧义：
```
场景 #1: <人类描述>
├─ 输入类型: UI / API / CLI / Backend / Data
├─ 输入详情: <具体参数/文件/操作>
├─ 期望输出: <预期结果>
├─ 严重度: blocker / critical / major / minor（若不匹配）
└─ 分配给哪个 atom: <molecule 自动推断，人类可覆盖>
```

**生成 Test Case Sheet**：

收集完成后，molecule 生成结构化 sheet 并请人类确认：

```markdown
## Human-Specified Test Cases

| # | Scenario | Input | Expected Output | Severity | Assigned Atom |
|---|----------|-------|-----------------|----------|---------------|
| 1 | Login with expired token | POST /auth/refresh {expired_jwt} | 401 "token expired" | critical | qa-api |
| 2 | Submit empty form | Click "Save" on /settings with all fields blank | 5 validation errors, form not submitted | major | qa-ui |
| 3 | Process large CSV | cli import --file 10k_rows.csv | stdout: "10000 rows imported in <30s" | major | qa-cli |
| 4 | Concurrent writes | 5 parallel PUT /items/1 | Only one succeeds, others get 409 Conflict | critical | qa-api |

✅ 确认以上 test cases？(y/n/edit/add)
```

**注入到 Atoms**：

Molecule 将 Test Case Sheet 写入 change 目录的 `qa-testcases.md`，并指示每个被调用的 atom：

> "除了你的标准 walkthrough checklist，额外验证 `qa-testcases.md` 中 assigned 给你的 test cases。
>  每个 case 验证后记录 Actual Output 并判定：✅ match / ❌ mismatch / ⚠️ partial。"

**空收集处理**：

如果人类回答 "none" 或 "done"（无 test cases），molecule 跳过此步骤，不生成 `qa-testcases.md`。Atoms 仅执行标准 walkthrough。

**Step 5: Execute atoms in sequence（含 human test cases）**

按序调用 atoms，每个 atom 都被告知去读取 `qa-testcases.md`（如果存在）并在 walkthrough 中包含这些验证：

1. `corgispec-qa-smoke`（must pass 才能继续）
2. Type-specific atoms（并行或串行，由 change type 决定）
   - 每个 atom 先执行标准 walkthrough checklist
   - 再从 `qa-testcases.md` 中筛选 assigned 给自己的 cases
   - 逐条执行 → 记录 Actual Output → 对比 Expected Output
3. `corgispec-qa-exploratory`（综合验证——包含未覆盖的 test cases 作为 explorative charter 的一部分）

每个 atom 产出结构化 findings，包含：
- `severity`: blocker / critical / major / minor / trivial
- `evidence`: 截图/日志路径
- `reproducible`: 是否可复现
- `test_case_result`: 仅对 human-specified cases — ✅ match / ❌ mismatch / ⚠️ partial

**Step 6: Assemble qa-report.md**

将所有 atom findings 汇总到统一报告。报告格式遵循 SBTM Session Report 标准：

```markdown
# Human QA Report: <change-name>

**Session ID:** QA-<change-name>-<date>
**Tester:** human (assisted by corgispec-human-qa)
**Date & Duration:** YYYY-MM-DD, X minutes
**Build/Environment:** <version>, <env>
**Change Type:** <UI|Backend|API|CLI|Full-stack|Mixed>
**Risk Level:** <Low|Medium|High|Critical>

## Charter / Mission
<change 的 QA 目标场景，由 molecule 自动生成>

## Human-Specified Test Cases
<如果收集了 test cases>

| # | Scenario | Expected | Actual | Status | Evidence |
|---|----------|----------|--------|--------|----------|
| 1 | Login with expired token | 401 "token expired" | 401 "token expired" | ✅ | ![[screenshot]] |
| 2 | Submit empty form | 5 validation errors | Only 4 errors — "email" field not validated | ❌ | ![[screenshot]] |
| 3 | Process large CSV | <30s | 18.3s | ✅ | `qa-evidence/logs/import-log.txt` |
| 4 | Concurrent writes | 409 Conflict | 409 Conflict | ✅ | ![[screenshot]] |

**Summary:** ✅ N passed / ❌ N failed / ⚠️ N partial

## Test Tours Applied
<基于风险分析推荐的 exploratory test tours>

## Smoke Test
| Check | Result | Evidence |
|-------|--------|----------|
| App launches | ✅/❌ | <screenshot/log> |
| Critical path accessible | ✅/❌ | <evidence> |

## Type-Specific Walkthroughs
<每个 type-specific atom 的结果汇总>

### UI Walkthrough
<来自 qa-ui atom>

### API Walkthrough
<来自 qa-api atom>

## Exploratory Session Findings
<来自 qa-exploratory atom>

| # | Finding | Severity | Reproducible | Evidence |
|---|---------|----------|-------------|----------|
| 1 | ... | 🔴 blocker | yes | ![[screenshot]] |

## Bug Reports
<严重度 ≥ major 的 finding 自动生成标准 bug report>

### BUG-001: <title>
- **Environment:** ...
- **Preconditions:** ...
- **Steps to Reproduce:** 1. ... 2. ...
- **Expected Result:** ...
- **Actual Result:** ...
- **Severity:** blocker / critical / major

## QA Conclusion

- **Status:** ✅ passed / ❌ failed / ⏭️ skipped
- **Skip Reason:**（仅 skipped 时）
- **Archive Recommendation:** Go / No-Go / Conditional
- **Follow-up Actions:** <建议的后续 QA session 或修复项>

## Evidence Inventory

| Type | Count | Location |
|------|-------|----------|
| Screenshots | N | qa-evidence/screenshots/ |
| API Logs | N | qa-evidence/logs/ |
| Recordings | N | qa-evidence/recordings/ |
```

写入路径：`openspec/changes/<name>/qa-report.md`

**Step 7: Post summary to tracker (if tracked)**

如果 change 被 tracker 跟踪：
1. 读取 tracker 文件获取 parent issue IID/number
2. 生成 QA 摘要（从 qa-report.md 提取关键信息）
3. 发布评论：
   - GitLab: `glab issue note <parent_iid> --message "$QA_SUMMARY"`
   - GitHub: `gh issue comment <parent_number> --body "$QA_SUMMARY"`
4. CLI 不可用时降级为终端输出 + 警告

**Step 8: Gate output**

```
## Human QA Complete

**Change:** <change-name>
**Type:** <type>
**Risk:** Low/Medium/High/Critical
**Status:** ✅ passed / ❌ failed / ⏭️ skipped
**Duration:** X min
**Atoms executed:** smoke, ui, exploratory
**Findings:** 🔴 N blocker | 🔴 N critical | 🟡 N major | 🔵 N minor | ⚪ N trivial
**Report:** openspec/changes/<name>/qa-report.md
**Evidence:** qa-evidence/ (N screenshots, N logs, N recordings)
**Tracker:** posted to #<issue> / not tracked

Next: Run /corgi-archive to archive this change.
```

---

### Phase 3: 创建 6 个 QA Atom Skills

所有 atoms 遵循统一模式：`SKILL.md` + `skill.meta.json`，存放在 `.opencode/skills/atoms/`。

#### 3.1 `corgispec-qa-smoke` — Smoke Test

**文件**:
- `.opencode/skills/atoms/corgispec-qa-smoke/SKILL.md`
- `.opencode/skills/atoms/corgispec-qa-smoke/skill.meta.json`

**职责**: "Does it even launch?" 5-15 分钟快速检查。如果 smoke 失败，任何更深的测试都没有意义。

**Walkthrough contract**:

```
最低要求：
- [ ] 应用/服务能启动（无 crash、无 500）
- [ ] 关键入口可访问（首页/health check/main endpoint）
- [ ] 无明显的运行时错误（console/日志检查）
- [ ] 新部署的构建版本号正确

如果失败 → 立即中止 QA，输出失败原因，标记为 failed。
如果通过 → 继续后续 atoms。
```

**skill.meta.json**:
```json
{
  "slug": "corgispec-qa-smoke",
  "tier": "atom",
  "version": "1.0.0",
  "description": "Smoke test gate — verifies the application launches and critical paths are accessible before deeper QA",
  "depends_on": [],
  "platform": "universal",
  "tags": ["qa", "smoke", "gate"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "atoms/corgispec-qa-smoke"
  }
}
```

---

#### 3.2 `corgispec-qa-ui` — UI Walkthrough

**职责**: 从真实用户视角走查 UI 变更。

**Walkthrough contract**（融合专业 QA 的 Component State / Responsive / Accessibility 方法论）:

```
最低要求：
- [ ] 打开真实页面（非 mock/单元测试页面）
- [ ] 按用户路径操作一遍：进入 → 交互 → 观察结果 → 退出
- [ ] 检查所有组件状态：loading / empty / error / edge case
- [ ] 至少 3 张关键截图：初始状态、操作中间态、最终结果
- [ ] 异常路径：触发至少一个错误场景，截图异常提示
- [ ] 响应式边界：如有表单，测试空输入、边界值、超长输入
- [ ] 键盘导航：Tab 顺序、Enter/Escape 行为、focus trapping
- [ ] 跨浏览器：Chrome +（Firefox 或 Safari，如果可行）

可选提升：
- [ ] Playwright 脚本自动化记录
- [ ] 移动端视口截图（375px / 768px）
- [ ] 暗色模式/高对比度模式
- [ ] 动画/过渡流畅度观察（jank detection）
```

**skill.meta.json**:
```json
{
  "slug": "corgispec-qa-ui",
  "tier": "atom",
  "version": "1.0.0",
  "description": "UI walkthrough — real user path verification with screenshots, component state checks, keyboard navigation, and cross-browser testing",
  "depends_on": [],
  "platform": "universal",
  "tags": ["qa", "ui", "walkthrough"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "atoms/corgispec-qa-ui"
  }
}
```

---

#### 3.3 `corgispec-qa-backend` — Backend Logic Walkthrough

**职责**: 从真实入口追踪调用链到目标逻辑，验证数据正确性。

**Walkthrough contract**:

```
最低要求：
- [ ] 从 root function 或真实入口调用到目标逻辑（非 unit test mock）
- [ ] 记录输入参数和实际返回值
- [ ] 至少 1 个 happy path + 1 个 error path
- [ ] 如有数据库操作：验证写入数据可被正确读取
- [ ] 调用链至少追踪 3 层深度
- [ ] Auth 金字塔: unauthenticated → authenticated → authorized → admin

可选提升：
- [ ] 性能基准对比（before/after）
- [ ] 边界值/并发测试观察
- [ ] 事务边界验证（回滚是否正确）
```

**skill.meta.json**:
```json
{
  "slug": "corgispec-qa-backend",
  "tier": "atom",
  "version": "1.0.0",
  "description": "Backend logic walkthrough — traces call chain from real entry points, verifies data integrity across layers",
  "depends_on": [],
  "platform": "universal",
  "tags": ["qa", "backend", "walkthrough"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "atoms/corgispec-qa-backend"
  }
}
```

---

#### 3.4 `corgispec-qa-api` — API Walkthrough

**职责**: 从真实 HTTP 客户端走查 API endpoint。

**Walkthrough contract**（融合专业 API QA 的 auth pyramid + CRUD + validation 方法论）:

```
最低要求：
- [ ] 从真实 HTTP 客户端或 curl 调用每个 endpoint
- [ ] 记录完整请求（method, URL, headers, body）
- [ ] 记录完整响应（status code, headers, body, latency）
- [ ] Auth 金字塔: 无认证 → 认证 → 权限不足 → 管理员
- [ ] 每种角色测试 CRUD 操作
- [ ] 至少 1 个 2xx + 1 个 4xx + 1 个 5xx（如果 triggerable）
- [ ] 验证响应格式与 spec 一致
- [ ] 边界测试: 空 body、超大 payload、特殊字符、SQL injection-like 输入

可选提升：
- [ ] OpenAPI/Swagger 文档一致性检查
- [ ] Rate limiting 行为验证
- [ ] 并发请求下的幂等性
```

**skill.meta.json**:
```json
{
  "slug": "corgispec-qa-api",
  "tier": "atom",
  "version": "1.0.0",
  "description": "API walkthrough — endpoint verification with auth pyramid, CRUD coverage, request/response validation, and edge case probing",
  "depends_on": [],
  "platform": "universal",
  "tags": ["qa", "api", "walkthrough"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "atoms/corgispec-qa-api"
  }
}
```

---

#### 3.5 `corgispec-qa-cli` — CLI Walkthrough

**职责**: 从终端走查 CLI 工具的行为。

**Walkthrough contract**:

```
最低要求：
- [ ] 从终端执行每个命令/子命令
- [ ] 测试 flag 组合: required flags, optional flags, conflicting flags
- [ ] 记录 stdout/stderr 原始输出
- [ ] 测试 --help 输出完整性
- [ ] 至少 1 个正常执行 + 1 个错误输入
- [ ] 验证退出码（0 for success, non-zero for error）
- [ ] 环境变量 override 测试
- [ ] 跨平台（如果可行）: Windows (PowerShell/CMD), macOS, Linux

可选提升：
- [ ] pipe/redirect 场景（stdin/stdout 兼容性）
- [ ] --json vs 纯文本输出一致性
- [ ] Shell completion 行为
```

**skill.meta.json**:
```json
{
  "slug": "corgispec-qa-cli",
  "tier": "atom",
  "version": "1.0.0",
  "description": "CLI walkthrough — terminal-based verification of commands, flags, exit codes, pipes, and help output",
  "depends_on": [],
  "platform": "universal",
  "tags": ["qa", "cli", "walkthrough"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "atoms/corgispec-qa-cli"
  }
}
```

---

#### 3.6 `corgispec-qa-exploratory` — Exploratory Testing Session

**文件**:
- `.opencode/skills/atoms/corgispec-qa-exploratory/SKILL.md`
- `.opencode/skills/atoms/corgispec-qa-exploratory/skill.meta.json`

**职责**: SBTM (Session-Based Test Management) 风格的探索性测试 session。

这是最丰富的 atom——它内建了 James Bach & Michael Bolton 的 SBTM 框架：

**Session 结构** (45-75 分钟):

| 阶段 | 时长 | 活动 |
|------|------|------|
| Charter | ~5 min | 定义 mission、scope、focus area。Molecule 预生成，人类确认/调整 |
| Explore | 30-55 min | 系统探索。agent 引导人类使用 Test Tours |
| Note | 持续 | 实时记录 findings。每一步截图/日志 |
| Debrief | 10-15 min | 总结、优先级排序、生成 bug report |

**12 个 Test Tours（agent 根据 change 自动推荐 2-4 个）**:

| Tour | 策略 | 何时推荐 |
|------|------|---------|
| Business District | 关键业务流程 | 所有变更 |
| Money | 收入相关功能 | 支付/计费变更 |
| Bad Neighborhood | 已知问题区域 | 历史 bug 密集模块 |
| Historical | 过去 bug 聚集处 | 修改历史遗留代码 |
| FedEx | 数据追踪（贯穿系统） | Full-stack 变更 |
| Rained-Out | 失败和错误场景 | 所有变更 |
| Obsessive-Compulsive | 重复操作 | 循环/批处理逻辑 |
| Garbage Collector | 清理和边界 | CRUD 操作 |
| Intellectual | 复杂逻辑功能 | 算法/业务规则变更 |
| Couch Potato | 最小努力路径 | UX 优化 |
| Landmark | 按关键功能导航 | 新功能 |
| Museum | 帮助文档和示例 | SDK/Library 变更 |

**session report 结构**（作为 qa-report.md 的 exploratory section）:

```markdown
## Exploratory Testing Session

- **Session ID:** EXP-<change>-<date>
- **Charter/Mission:** <预生成的 mission>
- **Duration:** X minutes
- **Tours Applied:** Business District, Rained-Out, FedEx
- **Coverage:** <哪些领域被覆盖>
- **Findings:** <N 个发现，含严重度>
- **Oddities:** <非 bug 但值得注意的奇怪行为>
- **Debrief Summary:** <关键收获和建议>
- **Evidence:** <截图/录屏/日志链接>
```

**skill.meta.json**:
```json
{
  "slug": "corgispec-qa-exploratory",
  "tier": "atom",
  "version": "1.0.0",
  "description": "SBTM-style exploratory testing session — charter-driven, tour-guided, time-boxed human investigation",
  "depends_on": [],
  "platform": "universal",
  "tags": ["qa", "exploratory", "sbtm"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "atoms/corgispec-qa-exploratory"
  }
}
```

---

### Phase 4: 改造 Archive Skills — 加入 QA Gate

#### 4.1 GitLab archive

**文件**: `.opencode/skills/molecules/corgispec-archive-change/SKILL.md`（修改）

在 Step 3（Check task completion）之后、Step 4（Assess delta spec sync）之前插入新 step：

**新 Step 3.5: Check Human QA status**

```
Read `openspec/changes/<name>/qa-report.md` if it exists.

If EXISTS:
  - Extract status from the "QA Conclusion" section:
    - ✅ passed → continue to Step 4
    - ❌ failed → STOP:
      "❌ Human QA failed for this change.
       Issues: <summary from qa-report.md>
       Fix the reported issues, re-run /corgi-human-qa, then archive."
    - ⏭️ skipped → continue, note in archive summary:
      "QA skipped: <reason from report>"

If NOT EXISTS:
  - WARN: "⚠️ No qa-report.md found. Human QA has not been performed.
    Archive without QA? This is not recommended. (y/n)"
  - If user confirms → continue with warning in archive summary:
    "⚠️ Archived without Human QA — no qa-report.md found"
  - If user declines → STOP
```

#### 4.2 GitHub archive

**文件**: `.opencode/skills/molecules/corgispec-gh-archive/SKILL.md`（修改）

插入与 4.1 完全相同的 QA gate step（逻辑与平台无关）。

---

### Phase 5: Web 研究引用

**文件**: `.opencode/skills/molecules/corgispec-human-qa/references/research-sources.md`（新建）

记录本设计所参考的 QA 方法论来源：

```markdown
# QA Methodology Research Sources

## Core Frameworks
- **SBTM**: Session-Based Test Management (James Bach, Michael Bolton)
- **HTSM**: Heuristic Test Strategy Model (James Bach)
- **Risk-Based Testing**: Risk Score = Likelihood × Impact
- **Test Tours**: 12 exploration strategies (Business District, Money, Bad Neighborhood, etc.)

## Professional QA Standards
- Manual Testing Guide (Quash, 2026)
- Exploratory Test Management (TestQuality)
- Building a Test Evidence Strategy (TestCollab)
- Bug Report Standards (BrowserStack)

## Specialized Testing
- Accessibility Testing Checklist (WCAG 2.1/2.2)
- Manual Web Application Security Testing (OWASP-based)
- User Acceptance Testing (UAT) Best Practices
- End-to-End Testing Templates
```

---

## Rationale

### 为什么用 Molecule → Atoms 而非单 Skill

1. **Skill Graph 2.0 层级合规**：Molecule 只调用 Atoms，不跨层不越界
2. **职责分离清晰**：Molecule 负责"分类 + routing + 报告组装"，Atoms 各负责一种类型的 walkthrough
3. **可独立迭代**：后续添加 `qa-database`、`qa-security`、`qa-accessibility` 等新 atom 时，只需新建 atom + 更新 molecule 的 `depends_on`，不影响已有 atoms
4. **复用潜力**：`qa-smoke` 和 `qa-exploratory` 可被未来的 compound 在其他工作流中复用

### 为什么 Smoke Test 是独立 Atom

遵循专业 QA 的铁律：**如果 smoke 失败，任何更深的测试都是浪费。** 独立的 smoke atom 可以被 molecule 作为 gate 调用——smoke 失败时 molecule 立即中止，不执行后续 atoms。

### 为什么 Exploratory Testing 是独立 Atom

SBTM 是专业 QA 的黄金标准。把 12 Test Tours + Session 结构放进一个独立 atom：
- 所有变更类型都适用（tours 不同但框架相同）
- 保持 SBTM 的 charter → explore → debrief 结构完整
- 未来可以微调 session 时长（当前 45-75min，以后可扩展）

### 为什么用 Risk Assessment（非简单分类）

简单的"UI/Backend/API"分类只考虑了技术维度。HTSM 的 Risk Heuristics 加入了：
- **历史维度**（Buggy = 此模块过去有多少 bug？）
- **业务维度**（Critical = 失败影响多大？Popular = 多少用户用？）
- **变化维度**（New vs Changed = 全新功能风险 > 已有功能微调）

这让 QA 深度与实际风险成正比，避免在低风险变更上过度投入。

### 为什么用 Bug Report Template

专业 QA 的标准做法：每个 ≥ major 的 finding 必须有完整的 bug report：
- Steps to Reproduce（任何人可照着复现）
- Expected vs Actual（让 dev 不用猜）
- Severity classification（blocker → critical → major → minor → trivial）
- Evidence link（截图/日志直接关联）

这些不只是记录——它们是 archive gate 的决策依据。

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| 6 个新 atom + 1 个 molecule 的初始实现量大 | 中 | 每个 atom 的核心是 checklist 式 walkthrough 指令，非复杂逻辑 |
| QA walkthrough 依赖运行环境（app 未部署/无测试数据） | 中 | Smoke atom 首先验证环境；fixture 检测提示用户准备数据；环境不满足时允许 skipped with reason |
| SBTM 45-75min session 对快节奏开发可能过重 | 低 | Molecule 的 Risk Assessment 决定 session 深度：Low risk → 缩短 session，High risk → 延长 |
| 截图/录屏文件体积大 | 低 | 存放在 `qa-evidence/` 子目录，archive 时一并移走；不污染 change 根目录 |
| Archive gate 在 qa-report.md 缺失时需 backward compat | 低 | 缺失时 warn + 用户确认（不硬 block），和现有 archive 哲学一致 |

## 文件变更清单

### 新建文件（Phase 1-3）

| 文件 | 类型 | 说明 |
|------|------|------|
| `.opencode/commands/corgi-human-qa.md` | Command wrapper | 浅层路由，读 config → dispatch 到 molecule |
| `.opencode/skills/molecules/corgispec-human-qa/SKILL.md` | Molecule skill | 分类 + routing + 报告组装 + tracker posting |
| `.opencode/skills/molecules/corgispec-human-qa/skill.meta.json` | Molecule meta | tier=molecule, depends_on=6 atoms |
| `.opencode/skills/atoms/corgispec-qa-smoke/SKILL.md` | Atom skill | Smoke test gate |
| `.opencode/skills/atoms/corgispec-qa-smoke/skill.meta.json` | Atom meta | tier=atom |
| `.opencode/skills/atoms/corgispec-qa-ui/SKILL.md` | Atom skill | UI walkthrough |
| `.opencode/skills/atoms/corgispec-qa-ui/skill.meta.json` | Atom meta | tier=atom |
| `.opencode/skills/atoms/corgispec-qa-backend/SKILL.md` | Atom skill | Backend logic walkthrough |
| `.opencode/skills/atoms/corgispec-qa-backend/skill.meta.json` | Atom meta | tier=atom |
| `.opencode/skills/atoms/corgispec-qa-api/SKILL.md` | Atom skill | API walkthrough |
| `.opencode/skills/atoms/corgispec-qa-api/skill.meta.json` | Atom meta | tier=atom |
| `.opencode/skills/atoms/corgispec-qa-cli/SKILL.md` | Atom skill | CLI walkthrough |
| `.opencode/skills/atoms/corgispec-qa-cli/skill.meta.json` | Atom meta | tier=atom |
| `.opencode/skills/atoms/corgispec-qa-exploratory/SKILL.md` | Atom skill | SBTM exploratory testing session |
| `.opencode/skills/atoms/corgispec-qa-exploratory/skill.meta.json` | Atom meta | tier=atom |
| `.opencode/skills/molecules/corgispec-human-qa/references/research-sources.md` | Reference | QA 方法论来源记录 |

### 修改文件（Phase 4-5）

| 文件 | 变更 |
|------|------|
| `.opencode/skills/molecules/corgispec-archive-change/SKILL.md` | Step 3 之后插入 QA gate step |
| `.opencode/skills/molecules/corgispec-gh-archive/SKILL.md` | Step 3 之后插入 QA gate step |
| `wiki/decisions/_index.md` | 添加本 decision 条目 ✓（已完成） |
| `wiki/log.md` | 追加记录 ✓（已完成） |

### 新增文件总计：16 个 | 修改文件：2 个（+ 2 个 wiki 已完成）

## 估时

| Phase | 内容 | 文件数 | 估时 |
|-------|------|--------|------|
| 1 | Command wrapper | 1 | 15min |
| 2 | Molecule skill（SKILL.md + meta.json，含 8 steps + 对话式 test case 收集协议） | 2 | 2h |
| 3 | 6 个 QA atoms（SKILL.md + meta.json ×6） | 12 | 3h |
| 4 | Archive gate 改造（GitLab + GitHub） | 2 | 30min |
| 5 | Research sources reference | 1 | 15min |
| **总计** | | **18** | **~6h** |

## Phase 2（后续迭代——本计划范围外）

以下 atoms 留待 Phase 2，在 Phase 1 的 6 个 atoms 稳定运行后追加：

| Atom | 职责 | 触发条件 |
|------|------|---------|
| `corgispec-qa-database` | DB migration QA — 数据完整性、rollback、幂等性、大表性能 | Migration 文件变更 |
| `corgispec-qa-security` | Security walkthrough — OWASP top 10, auth bypass, injection, session 管理 | Auth 逻辑变更、用户输入处理变更 |
| `corgispec-qa-accessibility` | a11y — WCAG 2.1, 键盘导航、screen reader、颜色对比度 | UI 变更（尤其是表单/交互组件） |
| `corgispec-qa-performance` | 性能观察 — FPS/jank、Long Tasks、交互延迟、内存泄漏 | UI 动画变更、大数据量处理变更 |
| `corgispec-qa-e2e` | E2E scenario — 端到端用户旅程，跨越多层 | Full-stack 变更 |

其他 Phase 2 事项：
- Tracker-visible `qa` label/state（`workflow::qa`）
- `install-skills.sh` 中注册新 skills
- `AGENTS.md` / `README.md` workflow 图更新
- `/corgi:human-qa` slash command 别名
- Playwright 辅助自动化 UI walkthrough
- `qa-report.md` JSON schema 校验
