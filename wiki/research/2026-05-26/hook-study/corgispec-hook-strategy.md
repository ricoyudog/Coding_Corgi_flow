# CorgiSpec 跨平台统一 Hook 策略

> 基于 `claude-code-hooks.md`、`opencode-hooks.md`、`codex-hooks.md` 三份研究报告
> 日期: 2026-05-22

---

## 目录

1. [设计原则](#1-设计原则)
2. [通用 Hook 格式](#2-通用-hook-格式)
3. [Hook → CorgiSpec 阶段映射](#3-hook--corgispec-阶段映射)
4. [分阶段实施路线](#4-分阶段实施路线)
5. [每平台具体配置](#5-每平台具体配置)
6. [CLI 命令设计](#6-cli-命令设计)
7. [与现有架构的关系](#7-与现有架构的关系)

---

## 1. 设计原则

### 1.1 核心理念

```
"Skills 做决策，Hooks 做执行"

Skill = 需要人类判断的复杂工作流 (propose, review, explore)
Hook  = 确定性的、可重复的自动化 (验证、格式化、同步、注入)
```

### 1.2 四条铁律

| # | 原则 | 说明 |
|---|------|------|
| 1 | **Claude Code 格式为通用规范** | 以 `settings.json` 的 hooks 格式作为跨平台标准，各平台通过 adapter 映射 |
| 2 | **Hook 回调 CorgiSpec CLI** | Hook 脚本内部调用 `corgispec` 命令，逻辑集中在 CLI 中，hook 只是触发器 |
| 3 | **Phase 1 即可用，Phase N 逐步增强** | 不追求一步到位，先解决最有痛点的重复步骤 |
| 4 | **安全优先：fail-closed** | 安全相关的 hook（如 worktree 隔离检查）默认 block，非关键的异步 fire-and-forget |

### 1.3 统一格式概览

```
┌────────────────────────────────────────────────┐
│           CorgiSpec 通用 Hook 规范               │
│         (JSON, Claude Code 兼容格式)              │
├────────────────────────────────────────────────┤
│  Claude Code  │  OpenCode       │  Codex        │
│  settings.json│  原生 support   │  config.toml  │
│  (直接加载)    │  (via cc-hooks) │  (corgispec    │
│               │                 │   generate)   │
└────────────────────────────────────────────────┘
```

- **Claude Code**: 直接使用 `settings.json` 的 `hooks` key
- **OpenCode**: 通过 `opencode-cc-hooks` npm 插件加载 Claude Code 格式
- **Codex**: `corgispec hooks generate --platform codex` 生成为 `config.toml`

---

## 2. 通用 Hook 格式

### 2.1 标准 Hook JSON Schema

```json
{
  "corgispec": {
    "version": 1,
    "generatedBy": "corgispec hooks generate",
    "generatedAt": "ISO-8601"
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "corgispec hook session-start",
            "timeout": 10,
            "statusMessage": "CorgiSpec: Loading project context..."
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "corgispec hook pre-write",
            "timeout": 15,
            "statusMessage": "CorgiSpec: Validating file change..."
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "corgispec hook pre-bash",
            "timeout": 10,
            "statusMessage": "CorgiSpec: Checking command safety..."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "corgispec hook post-write",
            "timeout": 30,
            "runInBackground": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "corgispec hook stop-check",
            "timeout": 15
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "corgispec hook pre-compact",
            "timeout": 10
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "corgispec hook post-compact",
            "timeout": 10
          }
        ]
      }
    ],
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "corgispec hook worktree-create",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### 2.2 Hook 子命令映射

| Hook 事件 | CLI 子命令 | 功能 | 退出码语义 |
|---|---|---|---|
| `SessionStart` | `corgispec hook session-start` | 注入 change 状态 + 平台检测 + memory 上下文 | 0=上下文已注入 |
| `PreToolUse(Edit\|Write)` | `corgispec hook pre-write` | 验证文件变更合法性 (不在主 checkout 写 worktree 文件) | 2=阻止, 0=允许 |
| `PreToolUse(Bash)` | `corgispec hook pre-bash` | 拦截危险命令 (git push -f main 等) | 2=阻止, 0=允许 |
| `PostToolUse(Edit\|Write)` | `corgispec hook post-write` | 自动运行 `corgispec validate` 检查 skill 文件、自动格式化 | 0=完毕 (异步) |
| `Stop` | `corgispec hook stop-check` | 验证 TG postconditions、触发 GitLab sync、检查 auto-continue | 2=block (强制继续), 0=允许停止 |
| `PreCompact` | `corgispec hook pre-compact` | 备份当前 change 上下文到 memory | 0=备份完成 |
| `PostCompact` | `corgispec hook post-compact` | 重新注入 CLAUDE.md + change 状态 + memory | 0=上下文恢复 |
| `WorktreeCreate` | `corgispec hook worktree-create` | 初始化 worktree 中的 Corgi 结构 | 0=就绪 |

---

## 3. Hook → CorgiSpec 阶段映射

### 3.1 当前每个阶段的痛点

| 阶段 | 当前重复步骤 (每个 skill/command 都写) | Hook 解决方案 |
|---|---|---|
| **所有阶段** | "Read config.yaml → detect schema → check isolation" | `SessionStart` 自动注入上下文 |
| **propose** | worktree 创建后手动初始化 | `WorktreeCreate` 自动初始化 |
| **apply** | closeout 手动 sync GitLab + memory writes | `Stop` 自动 sync |
| **apply** | "NEVER auto-continue" 仅靠文字约束 | `Stop` hook 退出码 2 强制阻止 |
| **apply** | "NEVER work in main checkout" 仅靠文字约束 | `PreToolUse` hook 阻止 worktree 外文件写 |
| **review** | 手动 post review report 到 GitLab | `Stop` 自动同步 review 状态 |
| **archive** | 清理 worktree + 更新 memory | `WorktreeRemove` + `Stop` 自动处理 |
| **所有阶段** | 压缩后丢失上下文 | `PostCompact` 重新注入 |

### 3.2 简化后的 Skill 结构

> ⚠️ **2026-05-26 更新**: 此简化方向已被 [[wiki/decisions/2026-05-26/hooks-augment-not-replace-skills|Decision: Hooks Augment, Not Replace]] 逆转。Skill 文件保留所有步骤作为 fallback，改用显式门控（"If context contains X → SKIP"）替代删除步骤。下方的 "改后" 示例不再是目标架构。

**改前 (apply skill 示例):**
```
Step 1: Read config.yaml for isolation settings
Step 2: Get status and apply instructions
Step 3: Parse Task Groups
Step 4: Execute TG
Step 5: Closeout → sync GitLab, write memory, verify postconditions
Step 6: Report checkpoint and STOP
```

**改后:**
```
Step 1: Parse Task Groups (context already loaded by SessionStart)
Step 2: Execute TG
Step 3: Report checkpoint → STOP (postconditions verified by Stop hook)
```

删除的重复步骤：config 读取、isolation 检查、GitLab sync、memory write、postcondition 验证 → 全部由 hooks 自动处理。

---

## 4. 分阶段实施路线

### Phase 1: 环境注入 🟢 (立即收益)

**目标**: 删除所有 skill 和 command 中重复的 "读取 config → 检测平台 → 检查 isolation" 模板

| Hook | 事件 | 平台支持 | 实现 |
|---|---|---|---|
| context-inject | `SessionStart` | CC ✅ OC ✅ CX ✅ | `corgispec hook session-start` → stdout JSON |
| context-restore | `PostCompact` | CC ✅ OC ✅ CX ✅ | `corgispec hook post-compact` → stdout JSON |

**产出**:
- `.claude/settings.json` 中新增 `SessionStart` + `PostCompact` hooks
- `corgispec hook session-start` CLI 子命令
- ~~所有 skill 文件删除 Step 1 中的 config/isolation 检测文本~~ → **已逆转 (2026-05-26)**。改为：所有 skill 文件 Step 1 添加显式门控逻辑，保留 fallback 步骤

### Phase 2: 安全护栏 🟡

**目标**: 将 "NEVER do X" 的文字约束变成平台强制执行

| Hook | 事件 | 阻止的行为 |
|---|---|---|
| worktree-guard | `PreToolUse(Edit\|Write)` | isolation=worktree 时在主 checkout 修改文件 |
| bash-firewall | `PreToolUse(Bash)` | `git push -f main/master`, `rm -rf /` |
| schema-protect | `PreToolUse(Edit\|Write)` | 非 install 上下文修改 `openspec/schemas/` |
| auto-validate | `PostToolUse(Edit\|Write)` | 修改 `SKILL.md` 后自动 `corgispec validate` |

### Phase 3: 工作流自动化 🔵

| Hook | 事件 | 自动化的操作 |
|---|---|---|
| tg-postcondition | `Stop` | 验证 TG 所有 tasks `[x]`、未 auto-continue、退出码 2 阻止违规停止 |
| gitlab-sync | `Stop` | 同步 GitLab issue 状态、label 变更、progress 更新 |
| memory-extract | `Stop` + `PostToolUse` | 自动追加到 `memory/session-bridge.md` |
| worktree-init | `WorktreeCreate` | 自动运行 `corgispec init` 在 worktree 中 |

### Phase 4: Command/Skill 精简 🔴

> ⚠️ **2026-05-26 更新**: Phase 4 已被 [[wiki/decisions/2026-05-26/hooks-augment-not-replace-skills|Decision: Hooks Augment, Not Replace]] 暂缓执行。待 Codex 补齐 Stop block 和 WorktreeCreate 后重新评估。

**原定产出**: 
- 删除每个 command 中重复的 5 步模板 → 变成单行 dispatch
- 删除每个 skill 中的 config/isolation/memory 手动步骤
- Skills 变成纯粹的指令内容，不再含基础设施代码

---

## 5. 每平台具体配置

### 5.1 Claude Code (`.claude/settings.json`)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [{
          "type": "command",
          "command": "corgispec hook session-start",
          "timeout": 10
        }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "corgispec hook pre-write",
          "timeout": 15
        }]
      },
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "corgispec hook pre-bash",
          "timeout": 10
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "corgispec hook post-write",
          "timeout": 30,
          "runInBackground": true
        }]
      }
    ],
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": "corgispec hook stop-check",
          "timeout": 15
        }]
      }
    ],
    "PostCompact": [
      {
        "hooks": [{
          "type": "command",
          "command": "corgispec hook post-compact",
          "timeout": 10
        }]
      }
    ],
    "WorktreeCreate": [
      {
        "hooks": [{
          "type": "command",
          "command": "corgispec hook worktree-create",
          "timeout": 30
        }]
      }
    ]
  }
}
```

### 5.2 OpenCode (`opencode.json` + `opencode-cc-hooks`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-cc-hooks@latest"
  ]
}
```

`opencode-cc-hooks` 自动读取 `~/.claude/settings.json` 或项目 `.claude/settings.json` 中的 hooks 配置，翻译为 OpenCode 事件：

| Claude Code Event | OpenCode Mapping |
|---|---|
| `SessionStart` | `experimental.chat.system.transform` + `session.created` |
| `PreToolUse` | `tool.execute.before` (exit 2 → `{ blocked: true }`) |
| `PostToolUse` | `tool.execute.after` |
| `Stop` | `session.idle` (exit 2 → `{ decision: "block", inject_prompt: "..." }`) |
| `PostCompact` | `experimental.session.compacting` |

**深层次需求** (OpenCode 独有能力):

当需要 Claude Code 格式不支持的功能时，使用 OpenCode 原生 plugin:

```ts
// .opencode/plugins/corgispec-deep.ts
import type { Plugin } from "@opencode-ai/plugin";

export const CorgiSpecDeep: Plugin = async () => {
  return {
    // 仅 OpenCode 支持: 动态注入 spec 到系统 prompt
    "experimental.chat.system.transform": async ({ output }) => {
      const specContext = await readSpecContext();
      output.system.push(...specContext);
    },

    // 仅 OpenCode 支持: 运行时注册 corgi 专用 tool
    tool: {
      async corgispecValidate({ tool }) {
        return tool({
          description: "Validate Corgi artifacts",
          args: { path: z.string().optional() },
          execute: async ({ path }) => {
            return execSync(`corgispec validate ${path || ""}`).toString();
          }
        });
      }
    }
  };
};
```

### 5.3 Codex (`.codex/config.toml`)

由 `corgispec hooks generate --platform codex` 生成：

```toml
[features]
hooks = true

# CorgiSpec: Session context injection
[[hooks.SessionStart]]
matcher = "startup|resume"

[[hooks.SessionStart.hooks]]
type = "command"
command = 'python3 "${HOME}/.codex/hooks/corgispec_session_start.py"'
commandWindows = 'python3 "%USERPROFILE%\.codex\hooks\corgispec_session_start.py"'
async = true
timeout = 10
statusMessage = "CorgiSpec: Loading project context..."

# CorgiSpec: File write guard
[[hooks.PreToolUse]]
matcher = "^(Edit|Write|apply_patch)$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = 'python3 "${HOME}/.codex/hooks/corgispec_pre_write.py"'
commandWindows = 'python3 "%USERPROFILE%\.codex\hooks\corgispec_pre_write.py"'
timeout = 15
statusMessage = "CorgiSpec: Validating file change..."

# CorgiSpec: Bash safety
[[hooks.PreToolUse]]
matcher = "^Bash$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = 'python3 "${HOME}/.codex/hooks/corgispec_pre_bash.py"'
commandWindows = 'python3 "%USERPROFILE%\.codex\hooks\corgispec_pre_bash.py"'
timeout = 10
statusMessage = "CorgiSpec: Checking command safety..."

# CorgiSpec: Post-write auto-validate
[[hooks.PostToolUse]]
matcher = "^(Edit|Write|apply_patch)$"

[[hooks.PostToolUse.hooks]]
type = "command"
command = 'python3 "${HOME}/.codex/hooks/corgispec_post_write.py"'
commandWindows = 'python3 "%USERPROFILE%\.codex\hooks\corgispec_post_write.py"'
timeout = 30
async = true

# CorgiSpec: Stop check
[[hooks.Stop]]

[[hooks.Stop.hooks]]
type = "command"
command = 'python3 "${HOME}/.codex/hooks/corgispec_stop_check.py"'
commandWindows = 'python3 "%USERPROFILE%\.codex\hooks\corgispec_stop_check.py"'
timeout = 15

# CorgiSpec: Post-compact context restore
[[hooks.PostCompact]]

[[hooks.PostCompact.hooks]]
type = "command"
command = 'python3 "${HOME}/.codex/hooks/corgispec_post_compact.py"'
commandWindows = 'python3 "%USERPROFILE%\.codex\hooks\corgispec_post_compact.py"'
timeout = 10
```

**注意**: Codex 目前缺少 `WorktreeCreate` 事件，worktree 初始化保持在 skill 内部手动完成。

---

## 6. CLI 命令设计

### 6.1 新增 `corgispec hook` 子命令

```
corgispec hook <subcommand> [options]
```

| 子命令 | 用途 | stdin | stdout |
|---|---|---|---|
| `session-start` | 会话启动上下文注入 | hook 事件 JSON | `{ additionalContext: "..." }` |
| `pre-write` | 文件写前验证 | `{ tool_name, tool_input: { file_path, ... } }` | `{ continue: true/false }` 或 exit 2 |
| `pre-bash` | Bash 命令安全检查 | `{ tool_input: { command } }` | `{ continue: true/false }` 或 exit 2 |
| `post-write` | 文件写后自动验证 | `{ tool_input: { file_path } }` | 异步，exit 0 |
| `stop-check` | 回合结束验证 | `{ stop_reason, ... }` | `{ decision: "block"/null }` 或 exit 2 |
| `pre-compact` | 压缩前备份 | `{ compact_trigger }` | exit 0 |
| `post-compact` | 压缩后恢复 | `{ compact_trigger }` | `{ additionalContext: "..." }` |
| `worktree-create` | Worktree 初始化 | `{ cwd }` | exit 0 |

### 6.2 新增 `corgispec hooks generate` 命令

```bash
# 生成 Claude Code 配置
corgispec hooks generate --platform claude --output .claude/settings.json

# 生成 Codex 配置
corgispec hooks generate --platform codex --output .codex/config.toml

# 生成 OpenCode 配置 (plugin 注册 + hook 脚本)
corgispec hooks generate --platform opencode --output .opencode/

# 全部生成
corgispec hooks generate --all
```

**生成策略**:
1. 读取 `openspec/config.yaml` 获取 `schema` 和 `isolation` 设置
2. 根据 `isolation.mode` 动态启用/禁用 worktree 相关 hooks
3. 根据 `schema` (gitlab-tracked / github-tracked) 启用对应的 GitLab/GitHub sync hooks
4. 输出的配置包含 `corgispec.metadata` 字段，记录生成时间、版本、启用的 hook 列表

### 6.3 stub 实现思路

所有 `corgispec hook *` 子命令内部调用现有 CLI 逻辑：

```
corgispec hook session-start
  ├── 读取 openspec/config.yaml → 检测 schema, isolation
  ├── 运行 corgispec status --json → 获取当前 change 状态
  ├── 读取 memory/session-bridge.md → 获取上次会话上下文
  └── 输出 JSON: { additionalContext: "..." }

corgispec hook pre-write
  ├── 解析 stdin: { tool_input: { file_path } }
  ├── 如果 isolation=worktree 且 file_path 不在 worktree 内 → exit 2
  ├── 如果 file_path 匹配 openspec/schemas/* 且不在 install 上下文 → exit 2
  └── exit 0

corgispec hook stop-check
  ├── 读取 tasks.md → 检查当前 TG 所有 tasks 是否 [x]
  ├── 如果未完成 → stderr "TG not complete" → exit 2 (强制继续)
  ├── 如果完成 → 调用 glab/gh 同步 issue 状态
  └── exit 0 (允许停止)
```

---

## 7. 与现有架构的关系

### 7.1 责任划分

```
┌─────────────────────────────────────────────────┐
│                    CorgiSpec                      │
├───────────────────┬─────────────────────────────┤
│    Skills (保留)   │      Hooks (新增)            │
├───────────────────┼─────────────────────────────┤
│ • propose         │ • SessionStart: 上下文注入    │
│ • apply-change    │ • PreToolUse: 安全护栏        │
│ • review          │ • PostToolUse: 自动验证/格式化 │
│ • archive-change  │ • Stop: 后置条件强制          │
│ • explore         │ • PostCompact: 上下文恢复      │
│ • install         │ • WorktreeCreate: 初始化       │
│ • verify          │                             │
│ • lint (可手动)    │                             │
└───────────────────┴─────────────────────────────┘
```

### 7.2 文件布局

```
<project>/
├── openspec/
│   └── config.yaml              # schema + isolation 设置
├── .claude/
│   ├── settings.json            # ← hooks 定义 (Claude Code + OpenCode via cc-hooks)
│   ├── commands/corgi/*.md      # 精简后的 command 文件
│   └── skills/corgispec-*/      # 精简后的 skill 文件
├── .opencode/
│   ├── commands/corgi-*.md      # 精简后的 command 文件
│   └── plugins/
│       └── corgispec-deep.ts    # OpenCode 深度插件 (可选, 超出 CC hook 能力)
└── .codex/
    ├── config.toml              # ← hooks 定义 (corgispec generate 生成)
    └── hooks/
        ├── corgispec_session_start.py
        ├── corgispec_pre_write.py
        ├── corgispec_pre_bash.py
        ├── corgispec_post_write.py
        ├── corgispec_stop_check.py
        └── corgispec_post_compact.py
```

### 7.3 Installer 集成

`corgispec install` 命令扩展：

```
Fresh Install 流程:
  5. 完成技能安装后输出:
     💡 Tip: Run `corgispec hooks generate` to enable auto context injection & security guards.

corgispec hooks generate 命令 (用户显式调用):
  - 检测可用平台 (Claude Code / OpenCode / Codex)
  - 如果检测到 Claude Code: 写入 .claude/settings.json (合并已有 hooks)
  - 如果检测到 OpenCode: 注册 opencode-cc-hooks 插件
  - 如果检测到 Codex: 运行 corgispec hooks generate --platform codex
  - 写入 .codex/hooks/ 目录中的 Python 脚本
```

> **2026-05-26 更新**: Installer 不自动生成 hooks 配置（避免覆盖用户已有的 settings.json），改为提示用户手动运行 `corgispec hooks generate`。参见 [[wiki/decisions/2026-05-26/hooks-augment-not-replace-skills|Decision]]。

### 7.4 向后兼容

- **Hooks 是可选的增强**，不是必需的迁移
- 没有 hooks 的平台（或 hooks 被手动禁用），现有 skill/command 照常工作
- `SessionStart` hook 注入的上下文与 skill 内部手动读取的结果一致，不会冲突
- `Stop` hook 的 TG 检查是现有 postcondition 文本的自动执行版本，增强而非替换

---

## 参考

- [[wiki/research/2026-05-26/hook-study/claude-code-hooks]] — Claude Code 28 events · 5 hook types
- [[wiki/research/2026-05-26/hook-study/opencode-hooks]] — OpenCode 14 plugin hooks + 40+ events
- [[wiki/research/2026-05-26/hook-study/codex-hooks]] — Codex 8 events · TOML+JSON
