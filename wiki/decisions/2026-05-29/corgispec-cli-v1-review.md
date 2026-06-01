---
type: wiki
updated: 2026-05-29
source: "[[openspec/changes/corgispec-cli|change: corgispec-cli]]"
status: proposed
---

# Decision: corgispec-cli v0.1.1 审查结果与修复计划

> 通过 4-agent 并行审查（spec compliance / code quality / test coverage / design audit），识别出 7 个需在下版本修复的问题。

## Context

`corgispec-cli` 变更（[[openspec/changes/corgispec-cli/proposal|proposal]]）所有 6 个 Task Group 已完成（[[openspec/changes/corgispec-cli/tasks|tasks]]），实现位于 `packages/corgispec/src/`。本次审查由 4 个专业 Agent 并行执行，覆盖 5 个 Capability Spec、32 个源文件、19 个测试文件。

审查方式：直接深度审查（非 `corgispec review` 指令流程）。

## Decision

### 总体评分

| 维度 | 评分 | 关键结论 |
|------|------|---------|
| Spec 合规 | **85%** | 1 CRITICAL 缺失，4 MODERATE 不匹配 |
| 代码质量 | **良好** | 3 CRITICAL，5 HIGH，18 MEDIUM |
| 测试覆盖 | **52%** | 10 个命令零 CLI 集成测试 |
| 设计执行 | **7/10** | D4 部分偏离，R2 CI 缺失 |

### 必须修复（P0，下一个版本）

| ID | 严重度 | 问题 | 文件 | 估时 |
|----|--------|------|------|------|
| C1 | 🔴 CRITICAL | `status --json` 缺失 `applyRequires` 字段 | `src/commands/status.ts` | 30min |
| C2 | 🔴 CRITICAL | `import.meta.dirname` 在 Node 18 不可用，schema 发现静默失败 | `src/commands/doctor.ts:186-187` | 15min |
| C3 | 🔴 CRITICAL | ~15 个空 `catch {}` 块吞没所有错误 | `skills.ts`, `hooks.ts`, `bootstrap.ts`, `doctor.ts`, `generate.ts` | 1h |
| C4 | 🔴 CRITICAL | `process.exit(1)` vs `process.exitCode = 1` 不一致（50/50 分裂） | 10+ 个命令文件 | 30min |

### 应该修复（P1，下一个版本）

| ID | 严重度 | 问题 | 文件 | 估时 |
|----|--------|------|------|------|
| M1 | 🟡 MODERATE | molecule 层级约束未实现（只有占位注释） | `src/lib/skills.ts:203-207` | 1h |
| M2 | 🟡 MODERATE | doctor schema 验证目标错误（验证 YAML 而非 JSON Schema） | `src/commands/doctor.ts:182-265` | 30min |
| M3 | 🟡 MODERATE | D4 模板变量解析延迟到消费方（偏离设计意图） | `src/lib/instructions.ts` | 2h |
| H1 | 🟡 HIGH | `err: any` 类型绕过（唯一一处） | `src/commands/apply.ts:72` | 5min |
| H2 | 🟡 HIGH | 未使用依赖 `glob` 和错位依赖 `@rollup/rollup-linux-x64-gnu` | `package.json` | 10min |
| H3 | 🟡 HIGH | `loadWorkflowSchema()` 无运行时形状校验 | `src/lib/changes.ts:83-96` | 30min |

### 测试覆盖缺口（P2，后续版本）

10 个命令**完全无 CLI 集成测试**：`install`, `validate`, `list`, `graph`, `propose`, `apply`, `review`, `archive`, `status`, `instructions`。

Spec 场景覆盖率：**52%**（33/64）。库函数测试充分，但 CLI 胶水层（参数解析、输出格式、退出码）完全未测。

### 无需修复（已知 & 接受）

| 项目 | 说明 |
|------|------|
| 消息文本不一致（"Corgi" vs "OpenSpec"） | 品牌替换有意为之，非 bug |
| `init` 额外创建 `openspec/specs/` | 增强功能，向后兼容 |
| `--no-color` 不完全剥离 ANSI | 当前通过 `FORCE_COLOR=0` 实现，对大多数场景足够 |
| 无 CI pipeline | 项目当前无 CI 策略（`AGENTS.md` 明确说明） |
| Codex 平台支持 | 增强功能，不影响 spec 合规 |

## Rationale

1. **P0 问题成本极低**：4 个 CRITICAL 共约 2h15m，均为单文件小改动
2. **P1 问题提升健壮性**：错误处理 + 类型安全是 CLI 工具的基础质量指标
3. **P2 测试缺口留待后续**：当前库函数测试充分，CLI 集成测试可在 v0.2.0 补充
4. **架构评分 7/10**：依赖方向正确、Commander 使用规范、tsup 配置正确、config 解析健壮

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| C2 修复遗漏 Node 18 测试 | 中 | `import.meta.dirname` 仅在 `doctor.ts` 一处使用，修复后需在 Node 18 环境验证 |
| C3 空 catch 加日志后输出噪音过多 | 低 | 使用 `console.error` 输出到 stderr，不影响 stdout 的正常 JSON 输出 |
| M3 模板变量解析改变输出格式 | 低 | 改变前需确认下游 AI agent 消费者兼容新格式 |

## 修复批次建议

```
Batch 1（P0，~2.5h）: C1 → C2 → C4 → C3
Batch 2（P1，~4h）:   H1 → H2 → H3 → M1 → M2 → M3
Batch 3（P2，~6h）:   补充 10 个命令的 CLI 集成测试
```
