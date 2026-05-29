---
type: wiki
updated: 2026-05-26
source: "[[wiki/research/2026-05-26/hook-study/corgispec-hook-strategy|CorgiSpec Hook Strategy]]"
status: accepted
---

# Decision: Hooks Augment Skills, Not Replace Them

> Hook 是 Skill 的补位增强，不是替代。Skill 文件保留所有步骤作为 fallback，有 hook 的平台自动受益，没 hook 的平台照常运行。

## Context

[[wiki/research/2026-05-26/hook-study/corgispec-hook-strategy|CorgiSpec 统一 Hook 策略]] 提出了用 hooks 自动化以下重复操作：

| 原 Skill 步骤                                           | Hook 自动化                       |
| ---------------------------------------------------- | ------------------------------ |
| "Read `openspec/config.yaml` for isolation settings" | `SessionStart` 注入上下文           |
| "STOP. Do not auto-continue"                         | `Stop` hook exit 2 强制阻止        |
| "NEVER work in the main checkout"                    | `PreToolUse(Edit\|Write)` 拒绝写入 |
| "NEVER auto-approve"                                 | `permission.ask` 程序化授权         |
| Postcondition checklist                              | `Stop` hook 自动验证               |
| Issue sync (GitLab/GitHub)                           | `Stop` hook 自动同步               |

### 多平台现实

Skill 文件跨三个平台共享（[[.claude/skills/]]、[[.opencode/skills/]]、[[.codex/skills/]]）。hooks 配置却**不是普遍存在的**：

| 平台 | hooks 默认状态 | 需要手动步骤 |
|------|-------------|------------|
| **Claude Code** | 无 hooks（需 `corgispec hooks generate` 或手动配置 `settings.json`） | ❌ |
| **OpenCode** | 无 hooks（需安装 `opencode-cc-hooks` 或原生 plugin） | ❌ |
| **Codex** | 无 hooks（需 `corgispec hooks generate --platform codex`） | ❌ |

此外，Codex 的 hooks 有架构性限制：
- `Stop` 事件**不支持 block**（exit code 2 无效），TG postcondition 只能 advisory
- 无 `WorktreeCreate` 事件，worktree 初始化无法自动化
- 无 HTTP webhook，外部服务同步需脚本内 subprocess 实现

### 问题

如果删除 Skill 文件中的 "Read config / detect isolation / scan worktree" 步骤：
1. **有 hooks 的平台**：上下文已注入，Skill 直接跳入决策逻辑 ✅
2. **没 hooks 的平台**：Agent 不知道当前 isolation mode、不知道有哪些 active changes → **Skill 跑不起来** ❌

这意味着：**Skill 文件的精简程度 = 最弱平台的 hooks 能力**。而 Codex（最弱平台）的 hooks 连 Stop block 都不支持。

## Decision

**Hook 作为补位增强，Skill 保留所有步骤作为 fallback。**

```
原则: Skill 用显式门控判断是否需要手动读取
      而不是依赖 Agent 自行推理是否跳过
```

### 具体做法

1. **Skill 文件步骤不删除** — 所有 "Read config.yaml"、"Check isolation mode"、"Scan worktrees" 步骤保留原样
2. **Hook 先注入上下文** — `SessionStart` hook 在 Agent 读 Skill 之前已经把 isolation mode、active changes、branch 等信息注入 context
3. **Skill 显式门控** — Skill Step 1 包含显式条件判断：
   ```
   If session context already contains ALL of:
     isolation.mode, active changes with worktree paths, current branch
   → Gate passed. SKIP to Step 2.
   Otherwise, read openspec/config.yaml and proceed with discovery.
   ```
   这是确定性条件判断，不依赖模型推理能力。跨模型（Opus/Sonnet/Haiku/GPT）可靠性远高于 Agent 自行决定
4. **没 hook 时照常** — 如果 hook 没触发，Agent 看到门控条件不满足 → 进入 fallback → 通过 CLI 获取上下文 → 继续

### 可以修改的

| 类型 | 做法 | 示例 | 适用平台 |
|------|------|------|----------|
| **Skill Step 1 门控** | 添加显式条件跳过逻辑 | 在 "Read `openspec/config.yaml`" 之前插入 `If context already contains isolation + changes + branch → SKIP to Step 2.` | ✅ 全平台 (确定性条件，不依赖 Agent 推理) |
| **PreToolUse 护栏文本** | 措辞从 "NEVER..." 改为 "🔒 Guard-enforced: NEVER..." | `NEVER work in main checkout` → `🔒 Guard-enforced: NEVER work in the main checkout.` | ✅ 全平台 (CC/OC/CX PreToolUse 均支持 block) |
| **Postcondition checklist** | 标出哪些已被 hook 自动验证（注明平台差异） | `[x] Tasks complete (auto-verified by Stop hook on CC/OC; advisory on Codex)` | ⚠️ CC/OC 强制；Codex advisory only |
| **Precondition 文案** | 补一句平台中立的 fallback 说明 | `Check if context is pre-loaded. If not, read openspec/config.yaml.` (不提及 "SessionStart hook") | ✅ 全平台 (平台中立措辞) |

> ⚠️ **关键约束**: **Stop 相关约束（auto-continue、TG complete）禁止添加 "Hook-enforced" 标记**。原因：Codex 的 Stop hook 不支持 block（exit code 2 无效），标记会产生平台强制执行的假象，反而削弱 Codex 上的原有文字约束。保留原始 `**STOP. Do not auto-continue.**` 文本，Stop hook 提供**并行**强制执行，不改变 Skill 文本。

### 不可以删除的

- 任何 config/context 读取步骤
- Worktree discovery 逻辑
- Isolation mode 检测分支
- "如果 X 则 Y" 的条件逻辑
- 手动 sync/memory write 的 fallback 指令

### 不可以添加的

- ❌ **Stop 约束的 "Hook-enforced" 标记** — Codex Stop hook 不支持 block，标记会误导 Codex Agent 以为平台会阻止
- ❌ **"By SessionStart hook" 等平台特定引用** — Skill 跨平台共享，不应假设特定 hook 存在。使用 "If context is pre-loaded..." 替代
- ❌ **平台特定的 hook 行为描述** — 不要在 Skill 中写 "Claude Code 上 Stop hook 会…" 等平台特化文本
- ❌ **依赖 Agent 推理的跳过提示** — 如 "Context should be pre-loaded..." 这种声明式文本。改为确定性的 "If context already contains X → SKIP"

### 平台差异处理

```
SessionStart hook output:

  Claude Code:  { additionalContext: "isolation=worktree, worktree at .worktrees/feat-foo, ..." }
  OpenCode:     (via opencode-cc-hooks bridge, same format)
  Codex:        (via Python script, same format)
  
  ↓ 所有平台 Agent 收到相同的上下文结构 ↓
  ↓ Skill 文件不需要知道上下文来自 hook 还是手动读取 ↓
```

## Rationale

1. **最低公分母原则**：跨平台共享的 Skill 文件必须以最弱平台的能力为上限。Codex 不支持 Stop block、没有 WorktreeCreate 事件，决定了 Skill 不能删除对应的手动步骤。

2. **Hook 配置不是自动安装的**：`corgispec install` 不会自动写 hooks 配置（需要 `corgispec hooks generate` 单独执行）。很多用户可能根本没运行这个命令。

3. **增量增强，不是迁移**：Hook 的价值是「删除 Agent 的执行时间」，不是「删除 Skill 的行数」。SessionStart hook 预注入上下文后，Skill Step 1 的显式门控 "context already contains X?" → 命中 → 直接跳 Step 2 → 省掉 20-40 秒的手动 discovery 时间。这个加速基于确定性条件判断，不依赖 Agent 推理。

4. **文本约束仍有价值**：即使有 Stop hook 强制阻止 auto-continue（CC/OC），Skill 里的 "STOP. Do not auto-continue" 文字仍然有用 —— 它告诉 Agent **为什么**被阻止了（hook exit 2 只会返回 stderr 的一行错误原因）。在 Codex 上（Stop hook 不支持 block），文本约束是**唯一**的阻止机制。

5. **维护成本可控，但需警惕 drift**：不删除步骤意味着 hooks 上线前后 Skill 文件主体不需要大幅改动（仅 Step 1 新增约 3 行门控逻辑）。但需注意：当 `config.yaml` 结构变化时，约 26 个文件（11 个 Skill × 2 平台 + 命令文件）中的对应文本需同步更新。跨平台 Skill 的文本 drift 风险真实存在，需通过 `corgispec lint` 做一致性检测。

## Alternatives Considered

- **删除 Skill 步骤，要求所有用户先跑 `corgispec hooks generate`**：对 Codex 用户的体验破坏太大。Codex 的 hooks 功能刚 GA（2026-05），很多用户还没升级到支持 hooks 的版本。
- **按平台维护三套不同的 Skill 文件**：维护成本爆炸。三套 Skill 很快就会 drift，导致行为不一致。
- **Skill 文件内用条件分支检测平台**：Agent 需要先执行检测逻辑才知道该走哪条路径 → 本末倒置。SessionStart hook 的目的就是让 Agent 不用做这个检测。
- **只在 Claude Code 上做 hooks，放弃 Codex/OpenCode**：违背 CorgiSpec 的跨平台定位。Codex 虽然 hooks 弱，但 SessionStart + PreToolUse + PostToolUse + PostCompact 四个核心事件都可用。

## Consequences

### 正面

- Skill 文件仅新增约 3 行显式门控逻辑（其余内容完全不动），hooks 上线不影响现有核心流程
- 有 hook 的平台自动受益（门控命中 → 跳过手动 discovery），没 hook 的平台不受影响（门控未命中 → 正常执行）
- 未来 Codex 补齐 Stop block、WorktreeCreate 等能力后，Skill 文件无需再改（门控逻辑已是最大公约数）
- 维护成本可控：三平台共享同一套 Skill 文件 + 同一套门控逻辑

### 负面

- Skill 文件仍然有 ~540 行重复的配置读取文本（但 Agent 在有 hook 时通过显式门控跳过，不会浪费执行时间）
- "NEVER" 文字约束仍然存在（但 hook 的强制执行大于文字约束，实际效果已达成）
- 新增的显式门控逻辑在没 hook 时约增加 ~60 tokens 的额外文本（"If context already contains..."），Agent 会快速判断条件为 false 并进入 fallback

### 对 Phase 1/2 路线的影响

Phase 1 和 Phase 2 的产出不变：
- ✅ 实现 `SessionStart` + `Stop` + `PreToolUse` + `PostToolUse` + `PostCompact` hooks
- ✅ 实现 `corgispec hook <subcommand>` CLI 命令
- ✅ 更新 `.claude/settings.json` 加入 hooks 配置

但 **Phase 4 "Skill 文件精简" 暂缓执行**，待以下条件满足时重新评估：

| 触发器 | 目标状态 | 评估行动 |
|--------|---------|---------|
| Phase 1-3 hooks 稳定运行 ≥ 3 个月 | 收集 Agent 跳过率数据 | 对比「门控命中率」vs「手动读取率」 |
| `corgispec hooks generate` 安装率 > 50% | 多数用户已有 hooks | 评估删除 fallback 步骤的安全性 |
| Codex 增加 Stop block 支持 | 最低公分母提升 | 重新评估是否可删除 Stop 相关的文字约束 |
| Codex 增加 WorktreeCreate 事件 | 全平台 worktree 自动化 | 重新评估是否可删除 worktree discovery 步骤 |
| 出现跨 Skill 的 config 文本不一致 bug | 维护成本超过收益 | 将精简作为 bug fix 而非 feature |

在满足至少 **2 个触发器** 之前，Skill 文件保持不动。hooks 上线后的收益体现在：
- Agent 响应速度（显式门控命中 → 跳过手动 discovery）
- 强制执行（PreToolUse block on all platforms；Stop block on CC/OC）
- 上下文一致性（每次 session 都有完整的 project state）

---

## Implementation Notes

### 需新增的 CLI 命令

```
corgispec hook session-start    # 输出项目上下文 JSON (isolation, active changes, branch)
corgispec hook pre-write        # 验证文件写入合法性 (stdin → exit 0/2)
corgispec hook pre-bash         # 拦截危险 Bash 命令 (stdin → exit 0/2)
corgispec hook post-write       # 自动运行 corgispec validate (async)
corgispec hook stop-check       # 验证 TG postconditions (stdin → exit 0/2)
corgispec hook post-compact     # 压缩后恢复上下文 (输出 additionalContext)
corgispec hooks generate        # 为目标平台生成 hooks 配置文件
```

### 各平台 hooks 配置文件

| 平台 | 配置位置 | 生成方式 |
|------|---------|---------|
| Claude Code | `.claude/settings.json` (hooks key) | 手动或 `corgispec hooks generate --platform claude` |
| OpenCode (轻量) | `.claude/settings.json` (via opencode-cc-hooks bridge) | 同 Claude Code + 注册 `opencode-cc-hooks` plugin |
| OpenCode (深度) | `.opencode/plugins/corgispec-deep.ts` | 手动 + `corgispec hooks generate --platform opencode` |
| Codex | `.codex/config.toml` + `.codex/hooks/*.py` | `corgispec hooks generate --platform codex` |

### SessionStart 上下文格式规范

`corgispec hook session-start` 输出以下 JSON 到 stdout（Claude Code 格式，OpenCode/Codex 通过 adapter 转换）：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "## CorgiSpec Project Context\n- **Schema**: gitlab-tracked\n- **Isolation mode**: worktree\n- **Active changes**:\n  - feat-corgispec-cli → .worktrees/feat-corgispec-cli (Group 2 in-progress)\n- **Current branch**: feat-corgispec-cli\n- **Worktree path**: .worktrees/feat-corgispec-cli\n- **Hooks active**: SessionStart, PreToolUse, PostToolUse, Stop, PostCompact"
  }
}
```

Skill Step 1 门控检查的字段与 `additionalContext` 中的 key 一一对应，确保确定性匹配。

### Hook CLI 接口契约

| 子命令 | stdin | stdout | 退出码语义 |
|--------|-------|--------|-----------|
| `session-start` | (无) | `{ hookSpecificOutput: { additionalContext: "..." } }` | 0 = 完成；非零 = 静默跳过 |
| `pre-write` | `{ tool_name, tool_input: { file_path } }` | `{ continue: true }` | 0 = 允许；2 = 阻止 |
| `pre-bash` | `{ tool_name, tool_input: { command } }` | `{ continue: true }` | 0 = 允许；2 = 阻止 |
| `post-write` | `{ tool_name, tool_input: { file_path } }` | (无，异步) | 0 = 完成 |
| `stop-check` | `{ stop_reason }` | `{ decision: "block" }` 或空 | 0 = 通过；2 = 阻止 (CC/OC only) |
| `post-compact` | `{ compact_trigger }` | `{ hookSpecificOutput: { additionalContext: "..." } }` | 0 = 完成 |
| `generate` | `--platform <name> [--output <path>]` | 写入平台配置文件 | 0 = 成功 |

### 测试策略

- **单元测试**: 每个 `corgispec hook <subcommand>` 在 `packages/corgispec/test/hooks/<subcommand>.test.ts`
- **集成测试**: 在每个目标平台上手动验证 hook 触发和 block 行为
- **紧急旁路**: `CORGISPEC_HOOKS_DISABLE=1` 环境变量临时禁用所有 hooks
- **回归防护**: CI 中模拟 hook stdin JSON 输入，验证 exit code 和 stdout 正确性
- **门控一致性**: `corgispec validate` 检查所有 Skill Step 1 是否包含显式门控逻辑
- **跨平台验证矩阵**:
  | 事件 | CC 验证 | OC 验证 | CX 验证 |
  |------|---------|---------|---------|
  | SessionStart | ✅ 上下文注入 | ✅ 上下文注入 | ✅ 上下文注入 |
  | PreToolUse block | ✅ exit 2 | ✅ exit 2 | ✅ exit 2 |
  | Stop block | ✅ exit 2 | ✅ exit 2 | ⚠️ advisory only |
  | PostCompact | ✅ 上下文恢复 | ✅ 上下文恢复 | ✅ 上下文恢复 |

### 用户发现路径

`corgispec install` 完成后输出提示：
```
✅ CorgiSpec installed. Skills: N molecules, N atoms.
💡 Tip: Run `corgispec hooks generate` to enable auto context injection & security guards.
```

`corgispec status` 输出包含 hook 状态：
```
Hooks: ❌ not configured → run `corgispec hooks generate`
Hooks: ✅ configured (SessionStart, PreToolUse, PostToolUse, Stop, PostCompact)
```

### 文件布局 (hooks 上线后)

```
<project>/
├── .claude/
│   ├── settings.json            # ← 新增 hooks 配置
│   ├── commands/corgi/*.md      # 不改动
│   └── skills/.../*.md          # 不改动
├── .opencode/
│   ├── package.json             # 已有 @opencode-ai/plugin
│   ├── plugins/
│   │   └── corgispec-deep.ts    # ← 新增: OpenCode 深度 plugin
│   ├── commands/corgi-*.md      # 不改动
│   └── skills/.../*.md          # 不改动
├── .codex/
│   ├── config.toml              # ← 新增: hooks 配置 (生成)
│   ├── hooks/                   # ← 新增: Python hook 脚本
│   │   ├── corgispec_session_start.py
│   │   ├── corgispec_pre_write.py
│   │   ├── corgispec_pre_bash.py
│   │   ├── corgispec_post_write.py
│   │   ├── corgispec_stop_check.py
│   │   └── corgispec_post_compact.py
│   └── skills/.../*.md          # 不改动
└── packages/corgispec/
    └── src/
        └── commands/
            └── hooks/            # ← 新增: hook CLI 命令
                ├── session-start.ts
                ├── pre-write.ts
                ├── pre-bash.ts
                ├── post-write.ts
                ├── stop-check.ts
                ├── post-compact.ts
                └── generate.ts
```

---

## Related

- [[wiki/research/2026-05-26/hook-study/corgispec-hook-strategy|CorgiSpec 跨平台统一 Hook 策略]] — 原始策略文档
- [[wiki/research/2026-05-26/hook-study/claude-code-hooks|Claude Code Hooks]] — 28 events, 5 types
- [[wiki/research/2026-05-26/hook-study/opencode-hooks|OpenCode Hooks]] — 14 plugin hooks, 40+ events
- [[wiki/research/2026-05-26/hook-study/codex-hooks|Codex Hooks]] — 8 events, command-only
