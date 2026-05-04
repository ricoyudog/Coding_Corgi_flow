---
type: wiki
updated: 2026-05-04
source: "[[addyosmani-agent-skills-verify-vs-review|research: addyosmani/agent-skills VERIFY vs REVIEW]]"
status: proposed
---

# Decision: Upgrade corgispec Review & Verify Pipeline

> 借鏡 addyosmani/agent-skills 的 VERIFY/REVIEW 分離設計，升級 corgispec 的品質保證流程。

## Context

目前 corgispec 流程為 4 階段：`propose → apply → review → archive`。其中 **verify（驗證）隱含在 apply 內**，review 只做 3 軸審查（code quality + spec coverage + functional verification），缺少：

- 獨立的 VERIFY 階段（自動化證明程式正確性）
- 反狡辯表（防止 agent 跳過關鍵步驟）
- 嚴重度分級（讓 review report 有行動指引）
- Architecture / Performance / Security 審查軸向

研究來源：[[addyosmani-agent-skills-verify-vs-review|addyosmani/agent-skills 對比研究]]

## Decision

分三階段（Tier 1 → Tier 2 → Tier 3）逐步升級 corgispec 的 Review & Verify 管線。

### Tier 1：強化既有 review（不改流程）

修改 `quality-checks.md` 一個檔案，加入：
1. **反狡辯表** — 5 條藉口 vs 反駁，放在 quality checks 開頭
2. **嚴重度分級** — 🔴Critical / 🟡Important / 🔵Suggestion / ⚪Nit
3. **擴充審查軸向** — 補 Architecture 和 Performance 檢查

### Tier 2：分離 VERIFY 階段（結構性改動）

新增 `corgispec-verify` 技能和 `/corgi-verify` 命令：
- 在 apply 之後、review 之前執行
- 全自動化（不需 human gate）
- 通過 verify 才能進入 review

### Tier 3：安全與效能深度檢查

新增參考文件 `security-checklist.md` 和 `performance-checklist.md`。

## Rationale

1. **Process over prose**：addyosmani 的核心設計哲學。Skill 必須是可執行的劇本，不是參考文件。
2. **Verification is mandatory**：先證明能動，再審查好不好。分離 verify 和 review 讓每一步的責任更清晰。
3. **Anti-rationalization**：反狡辯表是 addyosmani 最具突破性的設計。Agent 在用戶壓力下會找藉口跳過步驟，預製反駁是唯一有效對策。
4. **Severity matters**：沒有分級的 review report 缺乏行動指引。工程師需要知道「什麼必須修」vs「什麼可以忽略」。
5. **Tier 1 先做因為成本極低**：只改一個檔案，不影響任何流程合約，立即提升 review report 品質。

## Alternatives Considered

- **一次全部做 Tier 1+2+3**：風險太高，Tier 2 涉及新技能和命令，需要充分測試
- **不做 verify 分離，只在 review 內強化**：無法解決「拿明顯壞掉的程式進 review」的問題，review 應該只做判斷不做自動化驗證
- **直接複製 addyosmani 的 SKILL.md**：無法直接套用，corgispec 有自己的 GitLab 整合、worktree 隔離、human gate 流程。需要適配而非複製

---

## Plan: Tier 1 — Review 強化

### 修改範圍

| 檔案 | 變更 |
|------|------|
| `.claude/skills/corgispec-review/references/quality-checks.md` | 加反狡辯表、擴充審查軸向、改 report 格式 |
| (同步) `.opencode/skills/corgispec-review/references/quality-checks.md` | 同上 |
| (同步) `.codex/skills/corgispec-review/references/quality-checks.md` | 同上 |

### Spec-Level Requirements

#### REQ-T1-1: Anti-Rationalization Guard

在 quality checks 執行前，agent 必須先讀取並確認反狡辯表。

**反狡辯表內容**：

| 藉口 (Agent 會說的) | 反駁 (Skill 內建的) |
|---------------------|---------------------|
| "能跑就夠了" | 能跑但不可讀/不安全/架構錯誤的程式產生複利債務。Review 就是品質關卡。 |
| "只是小改動不用審" | 歷史上的重大事故中，60% 來自於被跳過審查的「小改動」。 |
| "我寫的我知道它是對的" | 作者對自己的假設有盲點。每段程式都需要另一雙眼睛。 |
| "AI 生成的應該沒問題" | AI 程式需要更多審查，不是更少。它自信且 plausible，但可能是錯的。 |
| "測試有過就好" | 測試必要但不充分。測試不抓架構問題、安全漏洞、可讀性問題。 |
| "以後再整理" | 「以後」永遠不會來。Review 就是品質關卡 — 現在就要求清理。 |
| "Review 太花時間" | 未 review 的 bug 修復成本是 review 時發現的 10 倍。 |

**驗收標準**：
- [ ] quality-checks.md 開頭包含完整的反狡辯表
- [ ] Review 流程的 Step 4 引用反狡辯表

#### REQ-T1-2: Severity Classification

Review Report 中的每個發現都必須標註嚴重度等級。

**嚴重度定義**：

| 等級 | 標記 | 定義 | 範例 |
|------|------|------|------|
| **Critical** | 🔴 | 必須修復才能 approve | 安全漏洞、資料遺失風險、核心功能損壞 |
| **Important** | 🟡 | 應修復或明確討論後才能 approve | 缺少測試、錯誤處理不佳、不符合 spec |
| **Suggestion** | 🔵 | 建議改善，非必要 | 命名優化、可選重構、更好的抽象 |
| **Nit** | ⚪ | 格式/風格偏好，可忽略 | 空格、換行、個人偏好 |
| **FYI** | ℹ️ | 資訊性，無需行動 | 未來注意事項、背景說明 |

**驗收標準**：
- [ ] Review Report Format 中的 Status 欄改用嚴重度標記
- [ ] Summary 區段按嚴重度分組統計（🔴 N / 🟡 N / 🔵 N / ⚪ N / ℹ️ N）
- [ ] Code Quality、Spec Coverage、Functional Verification 表格都使用新標記

#### REQ-T1-3: Architecture Check

新增架構審查維度，檢查實作是否遵循系統設計。

**檢查項目**：
- 變更是否遵循既有設計模式？（若引入新模式，是否有意為之且有文件？）
- 模組邊界是否乾淨？無循環依賴？
- 抽象層級是否恰當？（不過高不過低）
- 新引入的依賴是否必要且合理？

**驗收標準**：
- [ ] quality-checks.md 包含 Architecture Check 小節
- [ ] Review Report 包含 Architecture 區段

#### REQ-T1-4: Performance Check

新增效能審查維度，識別常見效能反模式。

**檢查項目**：
- 資料存取有無 N+1 query 模式？
- 有無缺少 pagination 的清單端點？
- 有無該非同步卻同步的操作？
- 前端：有無不必要的 re-render？
- 有無無界迴圈或可能記憶體洩漏？

**驗收標準**：
- [ ] quality-checks.md 包含 Performance Check 小節
- [ ] Review Report 包含 Performance 區段

#### REQ-T1-5: Updated Report Format

Review Report 格式全面升級以支援嚴重度分級和五軸審查。

**新格式骨架**：

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

### Performance
| Check | Status | Note |
|-------|--------|------|
| No N+1 queries | ✅ | — |
| Pagination present | ✅ | — |

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

**驗收標準**：
- [ ] Report 格式包含所有五個審查軸向
- [ ] 每個發現都有 Severity 標記
- [ ] Summary 按嚴重度分組統計

---

## Plan: Tier 2 — Verify 階段分離

### 修改範圍

| 檔案 | 變更 |
|------|------|
| `.claude/skills/corgispec-verify/SKILL.md` | **新增**：verify 技能主檔 |
| `.claude/skills/corgispec-verify/references/verification-steps.md` | **新增**：驗證步驟細節 |
| `.claude/commands/corgi/verify.md` | **新增**：`/corgi-verify` 命令 |
| `.claude/skills/corgispec-apply-change/references/checkpoint-flow.md` | **修改**：closeout 引導改為 `/corgi-verify` |
| (同步到 `.opencode/` 和 `.codex/`) | 同上全量同步 |

### Spec-Level Requirements

#### REQ-T2-1: Verify Skill 生命週期

Verify 在 apply closeout 之後、review 之前執行。流程：

```
apply closeout → verify → review → archive
                  ↑ 新增
```

**觸發條件**：
- `/corgi-verify` 命令
- apply closeout 完成後引導

**Verify 是自動化的**：不需要 human gate（不像 review）。所有檢查都是機器可執行的。

#### REQ-T2-2: 自動化測試執行

偵測專案測試基礎設施並執行。

| 偵測條件 | 執行命令 |
|----------|----------|
| `tests/` + `pytest.ini` / `pyproject.toml` with `[tool.pytest]` | `python -m pytest -v` |
| `package.json` with `"test"` script | `npm test` |
| 無測試基礎設施 | 報告 "No test infrastructure detected"，標記 ⚠️ |

**失敗處理**：
- 測試全通過 → ✅ 繼續
- 部分失敗 → ❌ 報告失敗測試，**不阻擋**但標記 🟡 Important
- 無測試 → ⚠️ 標記，不阻擋

#### REQ-T2-3: Spec 覆蓋率驗證

逐條對照 `specs/<capability>/spec.md` 的 Requirements 與實際實作。

**步驟**：
1. 讀取 group 對應的 spec（從 child issue 或 tasks.md 推斷）
2. 對每個 Requirement 比對：Scenario 行為是否在實作中找到對應邏輯？
3. 產出覆蓋率報告：幾條 fully covered / partially / uncovered

**輸出格式**：
```markdown
### Spec Coverage Verification
| Requirement | Coverage | Evidence |
|-------------|----------|----------|
| REQ-1: User login | ✅ Full | Implemented in auth/login.py:login() |
| REQ-2: Error handling | ⚠️ Partial | Happy path covered, null input not handled |
| REQ-3: Rate limiting | ❌ Missing | No rate limiting found in codebase |
```

#### REQ-T2-4: Lint / Build 驗證

- 執行 linter（若有配置）：`ruff check` / `eslint` / 專案約定
- 確認 build 成功（若有 build step）
- 無 lint/build 配置則跳過，標記 ℹ️

#### REQ-T2-5: Verify Report 產出

Verify 完成後產生結構化報告，貼到 GitLab child issue（若 tracked）。

**報告格式**：

```markdown
## Verify Report: Group N, {group name}

### Test Results
✅ 12 passed / ❌ 0 failed / ⚠️ 2 skipped

### Spec Coverage
| Requirement | Coverage | Evidence |
|-------------|----------|----------|
| ... | ... | ... |

**Summary**: ✅ 3/3 fully covered

### Lint / Build
✅ ruff: no errors | ✅ Build: success

### Verdict
✅ **PASS** — Ready for review
(or)
⚠️ **PASS WITH WARNINGS** — N items need attention but not blocking
(or)
❌ **FAIL** — N critical items must be fixed before review
```

#### REQ-T2-6: Gate to Review

- ✅ PASS → 引導：`Run /corgi-review to review this group`
- ⚠️ PASS WITH WARNINGS → 顯示警告，仍引導 review
- ❌ FAIL → 顯示失敗項目，引導回到 `/corgi-apply` 修復

**Verify 不能取代 review**。Verify 證明「程式能動」，Review 判斷「程式夠好」。

#### REQ-T2-7: Apply Closeout 引導更新

修改 `checkpoint-flow.md` 的 closeout 報告格式：

```
## Checkpoint: Group N Complete

**Change:** <name>
**Progress:** A/B tasks complete
**Worktree:** <path> or "none"

Run `/corgi-verify` to verify this group, then `/corgi-review` to review.
```

---

## Plan: Tier 3 — Security & Performance 深度檢查

### Spec-Level Requirements

#### REQ-T3-1: Security Checklist（參考文件）

新建 `.claude/skills/corgispec-review/references/security-checklist.md`。

**Always Check**（無例外）：
- [ ] No secrets in source code or git history
- [ ] All user input validated at system boundaries
- [ ] Parameterized queries (no string concatenation for SQL)
- [ ] Error responses don't expose internal details (stack traces, paths)

**Red Flags**（任一觸發則 🔴 Critical）：
- User input passed directly to shell commands
- API endpoints without authentication/authorization
- CORS using wildcard `*`
- Dependencies with known critical vulnerabilities (`npm audit` / `pip audit`)
- No rate limiting on authentication endpoints

#### REQ-T3-2: Performance Checklist（參考文件）

新建 `.claude/skills/corgispec-review/references/performance-checklist.md`。

**檢查項目**：
- [ ] N+1 query patterns
- [ ] Missing pagination on list endpoints
- [ ] Blocking synchronous operations
- [ ] Bundle size / import cost concerns
- [ ] Unbounded loops or memory leaks

**核心原則**：先量測再優化（Measure before optimizing）

#### REQ-T3-3: 整合到 Review Quality Checks

Security 和 Performance checklists 作為 quality-checks.md 的引用，review 時 agent 應逐條檢查。

---

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tier 1 改動破壞既有 review 流程 | 中 | 只改 quality-checks.md 內容，不改變 Step 順序或 human gate 合約 |
| Tier 2 verify 新增步驟增加使用者操作 | 低 | verify 全自動化，不需 human gate。使用者只需多打一個 `/corgi-verify` 命令 |
| Verify 和 Review 的功能重疊 | 低 | 明確分工：verify = 自動化證明（客觀），review = 人為判斷（主觀） |
| 三目錄同步遺漏 | 中 | 每次修改都要同步 `.claude/`、`.opencode/`、`.codex/` |
| Tier 3 security check 可能是 false positive | 中 | Red flags 是警示而非阻擋，最終由 human gate 判斷 |

## Success Metrics

- [ ] Review report 從 3 軸升級為 5 軸審查
- [ ] 每個 review finding 都有嚴重度標記
- [ ] 反狡辯表出現在每次 quality check 執行前
- [ ] Verify 階段獨立存在，在 apply 和 review 之間
- [ ] Verify report 產出自動化測試結果 + spec 覆蓋率
- [ ] Tier 1 完成後不影響任何既有流程合約（Step 5 human gate 不變）
