# Review: Quality Checks and Evidence Gathering

Use this procedure during the review phase, after the group is selected and before the human gate.

These checks gather evidence for the review report. They inform the user's decision, but they do not decide the outcome.

Do not change labels, close issues, update parent progress, or append repair tasks here.

## 0. Anti-Rationalization Guard (READ FIRST)

Before executing any quality checks, the agent MUST read and confirm the following anti-rationalization table.
If any of these excuses is detected influencing the review judgment, STOP and recalibrate.

| 藉口 (Agent 會說的) | 反駁 (Skill 內建的) |
|---------------------|---------------------|
| "能跑就夠了" | 能跑但不可讀/不安全/架構錯誤的程式產生複利債務。Review 就是品質關卡。 |
| "只是小改動不用審" | 歷史上的重大事故中，60% 來自於被跳過審查的「小改動」。 |
| "我寫的我知道它是對的" | 作者對自己的假設有盲點。每段程式都需要另一雙眼睛。 |
| "AI 生成的應該沒問題" | AI 程式需要更多審查，不是更少。它自信且 plausible，但可能是錯的。 |
| "測試有過就好" | 測試必要但不充分。測試不抓架構問題、安全漏洞、可讀性問題。 |
| "以後再整理" | 「以後」永遠不會來。Review 就是品質關卡 — 現在就要求清理。 |
| "Review 太花時間" | 未 review 的 bug 修復成本是 review 時發現的 10 倍。 |

## Severity Classification

Every finding in the review report MUST be tagged with a severity level. Use the following classification:

| 等級 | 標記 | 定義 | 範例 |
|------|------|------|------|
| **Critical** | 🔴 | 必須修復才能 approve | 安全漏洞、資料遺失風險、核心功能損壞 |
| **Important** | 🟡 | 應修復或明確討論後才能 approve | 缺少測試、錯誤處理不佳、不符合 spec |
| **Suggestion** | 🔵 | 建議改善，非必要 | 命名優化、可選重構、更好的抽象 |
| **Nit** | ⚪ | 格式/風格偏好，可忽略 | 空格、換行、個人偏好 |
| **FYI** | ℹ️ | 資訊性，無需行動 | 未來注意事項、背景說明 |

When in doubt between two levels, choose the HIGHER severity.

## 1. Code Quality Review

- Read all files produced by this group (from the child issue Rich Summary's file table)
- Check: code structure, obvious bugs or anti-patterns, naming and style consistency
- Produce: a short comment per file with severity-tagged status

## 2. Spec Verification

- Read `specs/<capability>/spec.md` from the change directory
- If no specs exist: note "No spec found for this group", skip
- Check each Requirement against the actual implementation
- Produce: coverage status per requirement with severity tag for gaps

## 3. Functional Verification

Detect project type and gather evidence. All detection is best-effort, skip gracefully.

- **Test infrastructure**: Check for `tests/` + `pytest.ini` / `pyproject.toml` with `[tool.pytest]`. If found: run `python -m pytest`, capture output.
- **UI**: Check for `.html`, `.tsx`, `.vue`, `.jsx`. If found: use Playwright to screenshot. Upload to GitLab: `glab api --method POST "projects/:id/uploads" -F "file=@screenshot.png"`
- **CLI**: Check for CLI entry points in `pyproject.toml` `[project.scripts]`. If found: run basic commands, capture output.
- **Fallback**: Try importing or executing the core function.

## 4. Architecture Check

Review the implementation against system design principles.

**Check items**:
- Does the change follow existing design patterns? If a new pattern is introduced, is it intentional and documented?
- Are module boundaries clean? No circular dependencies?
- Is the abstraction level appropriate? (Not too high, not too low — testable and composable)
- Are newly introduced dependencies necessary and justified?

**Produce**: Status per check item with severity tag for any violations.

## 5. Performance Check

Identify common performance anti-patterns in the implementation.

**Check items**:
- Data access: Any N+1 query patterns? (Check for queries inside loops)
- API endpoints: Any list endpoints missing pagination?
- Async/Sync: Any operations that should be asynchronous but are synchronous?
- Frontend: Any unnecessary re-renders? (React: missing useMemo/useCallback; check render-triggering state changes)
- Memory/CPU: Any unbounded loops or potential memory leaks? (Missing cleanup in useEffect, unclosed streams)

**Produce**: Status per check item with severity tag for any findings.

> **Core principle**: Measure before optimizing. Flag patterns, do not prescribe specific optimizations without benchmark data.

## 6. Security & Performance Deep Checks

For detailed security and performance checks, also read and follow these reference files if they exist in the review skill's references directory:

- `references/security-checklist.md` — Security-specific checks (always-check items and red flags)
- `references/performance-checklist.md` — Detailed performance patterns and detection techniques

These are supplementary — the Architecture and Performance sections above provide the baseline. The deep checklists add depth when the change warrants closer scrutiny.

## 7. Review Report Format

```markdown
## Review Report: Group N, {group name}

### Anti-Rationalization Check
已確認無下列藉口影響審查判斷：
- [x] "能跑就夠了" — 審查涵蓋可讀性、架構、安全、效能
- [x] "只是小改動" — 所有變更無論大小都經完整審查

### Code Quality
| File | Finding | Severity | Comment |
|------|---------|----------|---------|
| path/file.py | Clean structure | ℹ️ | — |

### Architecture
| Check | Status | Note |
|-------|--------|------|
| Follows existing patterns | ✅ | — |
| Module boundaries clean | ✅ | — |
| No circular dependencies | ✅ | — |
| Abstraction level appropriate | ✅ | — |
| New deps are necessary | ✅ | — |

### Performance
| Check | Status | Note |
|-------|--------|------|
| No N+1 queries | ✅ | — |
| Pagination present | ✅ | — |
| No blocking sync ops | ✅ | — |
| No unnecessary re-renders | ✅ | — |
| No unbounded loops | ✅ | — |

### Spec Coverage
| Requirement | Status | Severity (if issue) | Note |
|-------------|--------|---------------------|------|
| REQ-1: Basic functionality | ✅ | — | Implemented and tested |
| REQ-2: Error handling | ❌ | 🔴 Critical | Missing — no error path for null input |

### Functional Verification
| Item | Result | Severity | Note |
|------|--------|----------|------|
| core function works | ✅ Pass | — | See output |

### Test Results
{pytest output or "No test infrastructure detected"}

### Summary
🔴 N Critical | 🟡 N Important | 🔵 N Suggestions | ⚪ N Nits | ℹ️ N FYI
```

## 8. Post evidence to GitLab

```bash
glab issue note <child_iid> --message "$REVIEW_REPORT"
```

If screenshots were taken, upload first to get URLs, then embed in the report.

Posting the report records evidence only. Approval, rejection, and repair-side mutations happen later in `references/review-decisions.md`.
