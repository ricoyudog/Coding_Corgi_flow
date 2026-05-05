---
type: wiki
updated: 2026-05-05
source: https://github.com/addyosmani/agent-skills
---

# addyosmani/agent-skills: VERIFY vs REVIEW 階段對比研究

> 對比分析 addyosmani/agent-skills 中 Verify 和 Review 兩個階段的設計哲學、技能組成、反狡辯機制，並與本專案 corgispec-review 對照。

## 六階段生命週期中的位置

```
DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP
                          ↑ 這裡       ↑ 這裡
```

**VERIFY 在 REVIEW 之前** — 這是關鍵設計：先證明程式「能動」，再審查程式「寫得好不好」。

---

## 一、VERIFY 階段（證明功能正確性）

### 核心理念

> *"Prove it works, don't assume it works."*

VERIFY 關注的是**功能性**：程式是否按照預期執行？有沒有 bug？console 乾淨嗎？

### 三個技能

| 技能 | 一句話描述 | 斜槓命令 |
|------|-----------|----------|
| `test-driven-development` | 紅-綠-重構循環，測試先行 | `/test` |
| `browser-testing-with-devtools` | Chrome DevTools 即時運行時檢查 | — |
| `debugging-and-error-recovery` | 五步除錯分類流程 | — |

### `test-driven-development`

- **流程**：Red（寫失敗的測試）→ Green（寫最少的程式讓測試通過）→ Refactor（重構並保持綠燈）
- **反狡辯表重點**：*「測試拖慢速度」→ 除錯時間是測試的 3-5 倍*
- **驗證標準**：測試全數通過
- **Google 原則**：Beyoncé Rule、Test Pyramid (80/15/5)

### `browser-testing-with-devtools`

- **流程**：檢查 accessibility tree → heading 層級 → focus order → color contrast → dynamic content
- **「Clean Console Standard」**：生產級頁面必須零 console error 和 warning

**反狡辯表**（5 條）：

| 藉口 | 反駁 |
|------|------|
| "看起來沒錯啊" | Runtime 行為經常和程式碼表面不同，用瀏覽器實際驗證 |
| "Console warning 沒差" | Warning 會變成 error，乾淨 console 提早抓 bug |
| "之後再手動看瀏覽器" | DevTools MCP 讓 agent 當下就能自動驗證 |
| "Performance profiling 太誇張" | 1 秒的 trace 能抓到幾小時 code review 都漏掉的問題 |
| "測試通過表示 DOM 一定對" | 單元測試不測 CSS、layout、真實瀏覽器渲染 |

- **Red Flags**：沒在瀏覽器看過就交付 UI、忽略 console error、未調查的網路失敗、未測量的效能、未檢查的 accessibility tree
- **驗證標準**：6 項（無 console error、網路請求正確、視覺匹配 spec、accessibility tree 正確、效能指標達標、所有 DevTools 發現已處理）

### `debugging-and-error-recovery`

- **流程**：Reproduce → Localize → Reduce → Fix → Guard（回歸測試 + 端到端驗證）

**反狡辯表**（5 條）：

| 藉口 | 反駁 |
|------|------|
| "我知道 bug 在哪，直接修" | 你有 70% 機率是對的，剩下 30% 浪費幾小時。先 reproduce |
| "那個 failing test 大概是錯的" | 驗證這個假設。如果 test 錯了就修 test，不要跳過 |
| "我機器上能跑啊" | 環境不同。檢查 CI、config、dependencies |
| "下一個 commit 再修" | 現在修。下一個 commit 會在此 bug 上疊新 bug |
| "這是 flaky test，忽略它" | Flaky test 掩蓋真實 bug。修復 flakiness 或理解為什麼間歇性失敗 |

- **Red Flags**：跳過 failing test、不 reproduce 就猜測修復、治標不治本、沒有 regression test、除錯時同時做多個不相關的變更
- **驗證標準**：6 項（root cause 已記錄、修復針對 root cause、regression test 存在、所有測試通過、build 成功、原始 bug 場景端到端驗證）

---

## 二、REVIEW 階段（品質關卡）

### 核心理念

> *"Working code isn't enough. It must be correct, readable, secure, performant, and architecturally sound."*

REVIEW 關注的是**品質屬性**：程式碼的長期可維護性、安全性、效能、架構。

### 四個技能

| 技能 | 一句話描述 | 斜槓命令 |
|------|-----------|----------|
| `code-review-and-quality` | 五軸審查 + 嚴重度分級 | `/review` |
| `code-simplification` | 保持行為不變的前提下降低複雜度 | `/code-simplify` |
| `security-and-hardening` | OWASP Top 10 + 三層邊界系統 | — |
| `performance-optimization` | 先量測再優化 | — |

### `code-review-and-quality`（核心技能）

**五軸審查系統（Five-Axis Review）**：

| 軸向 | 檢查內容 |
|------|---------|
| **Correctness** | 是否按預期執行？邊界條件（null/空值）？錯誤路徑？測試覆蓋是否充分？ |
| **Readability** | 命名是否清晰？控制流是否直覺？組織是否合理？抽象層級是否恰當？ |
| **Architecture** | 是否遵循系統設計？模組邊界是否乾淨？有無循環依賴？ |
| **Security** | Input validation？Secret 處理？認證授權？參數化 SQL？Output encoding？ |
| **Performance** | N+1 query？無界迴圈？該非同步的同步操作？不必要的 re-render？缺 pagination？ |

**嚴重度分級**：

| 等級 | 定義 | 範例 |
|------|------|------|
| **Critical** | 阻擋合併，必須修復 | 安全漏洞、資料遺失風險、核心功能損壞 |
| **Important** | 合併前必須處理或討論 | 缺少測試、錯誤處理不佳 |
| **Suggestion** | 建議改善，非必要 | 命名優化、可選重構 |
| **Nit** | 格式/風格偏好，可忽略 | 空格、換行偏好 |
| **FYI** | 資訊性，無需行動 | 未來注意事項 |

**反狡辯表**（5 條）：

| 藉口 | 反駁 |
|------|------|
| "能跑就夠了" | 能跑但不可讀、不安全、架構錯誤的程式產生複利債務 |
| "我寫的，我知道它是對的" | 作者對自己的假設有盲點，每段程式都需要另一雙眼睛 |
| "以後再整理" | 「以後」永遠不會來。Review 就是品質關卡，現在就要求清理 |
| "AI 生成的程式應該沒問題" | AI 程式需要更多審查，不是更少。它自信且 plausible，但不一定是對的 |
| "測試通過所以沒問題" | 測試必要但不充分。測試不抓架構問題、安全問題、可讀性問題 |

**Review Agent Personas（審查人格）**：

| Persona | 角色 | 負責範圍 |
|---------|------|---------|
| `code-reviewer` | Senior Staff Engineer | 五軸審查，輸出 APPROVE/REQUEST CHANGES |
| `test-engineer` | 測試工程師 | 測試策略、覆蓋率分析、bug 重現（Prove-It Pattern） |
| `security-auditor` | 安全工程師 | 漏洞檢測、威脅建模、安全編碼實踐 |

### `code-simplification`

- **流程**：Understand (Chesterton's Fence) → Identify → Apply Incrementally → Verify
- **核心原則**：Chesterton's Fence — 不理解原因之前不要拆除「柵欄」

**反狡辯表**（7 條，最豐富）：

| 藉口 | 反駁 |
|------|------|
| "能跑就不要碰" | 難讀的程式壞掉時更難修。簡化現在省下每次 future change 的時間 |
| "行數少就是簡單" | 一行巢狀 ternary 不比五行 if/else 簡單。簡單是理解速度，不是行數 |
| "順便簡化一下不相關的程式" | 超出範圍的簡化製造 noisy diff 和回歸風險 |
| "型別讓程式自解釋" | 型別記錄結構，不記錄意圖。好名字的函數比型別簽名更能解釋 why |
| "這個抽象以後可能有用" | 不要保留推測性的抽象。現在沒用到就是無價值的複雜度，移除它 |
| "原作者一定有理由" | 也許。檢查 git blame，用 Chesterton's Fence。但累積的複雜度常無理由 |
| "我順便重構加功能" | 重構和功能分開。混在一起的變更更難 review、revert、理解歷史 |

- **驗證標準**：9 項（所有測試不改就通過、build 成功、linter 通過、每步可 review、diff 乾淨、遵循專案慣例、error handling 未削弱、無 dead code、同事會 approve）

### `security-and-hardening`

- **三層邊界系統**：
  - **Always Do**（無例外）：Input validation (zod)、參數化 SQL、安全 headers
  - **Ask First**（需人審批）：新認證流程、變更 CORS、儲存 PII
  - **Never Do**（硬阻擋）：commit secrets、eval()、log passwords

**反狡辯表**（5 條）：

| 藉口 | 反駁 |
|------|------|
| "內部工具不用考慮安全" | 內部工具也會被入侵，攻擊者瞄準最脆弱的一環 |
| "之後再加安全" | 安全補丁比內建難 10 倍，現在就加 |
| "沒人會想攻擊這個" | 自動掃描器會找到的。security by obscurity 不是安全 |
| "框架處理安全了" | 框架提供工具，不提供保證。你仍需要正確使用它們 |
| "只是原型" | 原型會變成生產。從第一天就建立安全習慣 |

- **Red Flags**：直接傳 user input 到 DB/shell/HTML、secrets 在原始碼中、API 沒有認證授權、CORS 用 wildcard、認證端點沒 rate limiting、stack trace 暴露給用戶、依賴有 known critical 漏洞

### `performance-optimization`

- **流程**：**MEASURE → IDENTIFY → FIX → VERIFY → GUARD**（嚴格先量測）
- **Anti-Patterns Catalog**：N+1 queries、unbounded data fetching、large bundle size、missing caching

**反狡辯表**（5 條）：

| 藉口 | 反駁 |
|------|------|
| "以後再優化" | 效能債會複利。現在修明顯 anti-pattern，微優化可以後做 |
| "我機器上很快" | 你的機器不是使用者的。在代表性硬體和網路環境上 profile |
| "這個優化很明顯" | 沒有量測就不知道。先 profile |
| "使用者不會注意到 100ms" | 研究顯示 100ms 延遲影響轉換率。使用者比你想的更敏感 |
| "框架處理效能了" | 框架防止部分問題，但救不了 N+1 query 或過大的 bundle |

- **驗證標準**：7 項（有前後量測數據、瓶頸已定位並解決、Core Web Vitals 達 Good 標準、bundle 未明顯增大、無 N+1 query、CI 效能預算通過、既有測試仍通過）

---

## 三、VERIFY vs REVIEW：核心哲學對比

| 維度 | VERIFY | REVIEW |
|------|--------|--------|
| **問題** | 「這段程式對嗎？」 | 「這段程式夠好嗎？」 |
| **關注點** | 功能性正確（functional） | 品質屬性（non-functional） |
| **執行時機** | Build 完成後 | Verify 通過後 |
| **證據類型** | 測試結果、console log、runtime behavior | 程式碼本身結構分析 |
| **可否自動化** | 高度可自動化（測試、DevTools） | 部分需人工判斷（架構、可讀性） |
| **失敗後果** | 回 BUILD 修復 | 回 BUILD 或 VERIFY 修復 |
| **技能數量** | 3 個 | 4 個 |
| **反狡辯表規模** | 15 條（5+5+5） | 22 條（5+7+5+5） |
| **斜槓命令** | `/test` | `/review`, `/code-simplify` |
| **Agent Persona** | 無 | 3 個（code-reviewer, test-engineer, security-auditor） |

---

## 四、與本專案 corgispec-review 對比

> **更新時間**: 2026-05-05 — 代碼稽核後修正。已完成項目以 ✅ 標記，未完成項以 ❌ 標記。

### 已實現項

| 維度 | corgispec-review (現狀) | addyosmani REVIEW | 實作位置 |
|------|------------------------|-------------------|----------|
| **Verify 分離** | ✅ `corgispec-verify` 獨立技能（v1.0.0） | ✅ Verify 和 Review 是兩個獨立階段 | `.opencode/skills/corgispec-verify/SKILL.md` |
| **審查軸向** | ✅ 6 軸（code quality, spec, functional, architecture, performance, security） | 5 軸（+architecture, performance） | `references/quality-checks.md` |
| **嚴重度分級** | ✅ 🔴Critical / 🟡Important / 🔵Suggestion / ⚪Nit / ℹ️FYI | ✅ Critical/Important/Suggestion/Nit/FYI | `references/quality-checks.md` §Severity Classification |
| **反狡辯表** | ✅ 7 條中英雙語藉口vs反駁表 | ✅ 每個 skill 都有完整的藉口-反駁表 | `references/quality-checks.md` §0 |
| **Human Gate** | ✅ Step 5 強制詢問 Approve/Reject/Discuss | ✅ 透過 slash command 的互動流程 | `SKILL.md` Step 5 |
| **Review Report** | ✅ 結構化報告含所有軸向 + 嚴重度摘要 | ✅ Verification Story 文件化 | `references/quality-checks.md` §7 |
| **安全檢查** | ✅ `security-checklist.md`（Always Check + Red Flags + 偵測腳本） | ✅ 完整的 security-and-hardening 技能 | `references/security-checklist.md` |
| **效能檢查** | ✅ `performance-checklist.md`（N+1/分頁/同步/記憶體 + 語言級偵測） | ✅ MEASURE→IDENTIFY→FIX→VERIFY→GUARD | `references/performance-checklist.md` |
| **自動化測試** | ⚠️ 已改進：多語言檢測（pytest/npm/bun/go/rust/make）但缺少 TDD 循環和 DevTools 整合 | 深入（TDD 循環 + DevTools + 回歸測試） | `references/verification-steps.md` |

### 未實現項

| 維度 | corgispec-review (現狀) | addyosmani REVIEW |
|------|------------------------|-------------------|
| **Persona 系統** | ❌ 無 — 無 code-reviewer/test-engineer/security-auditor sub-agent | ✅ 三個審查人格可獨立呼叫 |
| **簡化檢查** | ❌ 無 — 無 Chesterton's Fence / 增量簡化 / 反狡辯表 | ✅ Chesterton's Fence + 增量簡化 |

---

## 五、值得借鏡的設計（含實作狀態）

> **更新時間**: 2026-05-05 — 代碼稽核後的實作狀態。

### 1. ✅ 已實作：反狡辯表（Rationalizations Table）

這是 addyosmani 專案最具突破性的設計。**已實作**於 `references/quality-checks.md` §0，包含 7 條中英雙語藉口vs反駁表。GH 版（`corgispec-gh-review`）也已內聯實作。

### 2. ✅ 已實作：嚴重度分級

**已實作** 🔴Critical / 🟡Important / 🔵Suggestion / ⚪Nit / ℹ️FYI 五級體系，品質報告已有明確行動指引。GL 版在 `quality-checks.md`，GH 版內聯於 SKILL.md。

### 3. ✅ 已實作：Verify 階段分離

**已實作** `corgispec-verify` 獨立技能（v1.0.0），全自動化驗證關卡（測試/規格覆蓋/lint/build），坐落在 apply 和 review 之間。流程變為：`apply → verify → review → archive`。

### 4. ❌ 未實作：Agent Persona

addyosmani 的 code-reviewer/test-engineer/security-auditor 三個人格可以平行審查（`/ship` 指令會 fan-out），對大型變更特別有價值。**尚未實作**。

### 5. ✅ 已實作：Security 和 Performance checklists

**已實作** `references/security-checklist.md` 和 `references/performance-checklist.md`，作為 corgispec-review 品質檢查的擴充維度。GL 和 GH 版均有，內容相同。

### 6. ❌ 未實作：代碼簡化技能（Code Simplification）

addyosmani 的 `code-simplification` 技能含 Chesterton's Fence 原則、增量簡化流程、以及最豐富的 7 條反狡辯表。**尚未實作** — 無 `corgispec-code-simplify` 技能。

---

## 總結

> **更新時間**: 2026-05-05 — 代碼稽核後修正。

| | addyosmani VERIFY | addyosmani REVIEW | corgispec (2026-05-05 現狀) |
|---|---|---|---|
| **成熟度** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **深度** | 3 技能，15 條反狡辯 | 4 技能，22 條反狡辯，3 人格 | verify(1) + review(1) 技能，7 條反狡辯，安全+效能深度清單 |
| **覆蓋面** | 測試+瀏覽器+除錯 | 程式品質+簡化+安全+效能 | 測試+lint+build+spec覆蓋 + 程式品質+架構+安全+效能 |
| **可遷移性** | 跨平台通用格式 | 跨平台通用格式 | OpenSpec 專用 |

### 稽核結論

經 2026-05-05 代碼稽核，corgispec 已從 addyosmani 借鏡並實作 **8 項中的 6 項**：

| 狀態 | 項目 |
|------|------|
| ✅ 已實作 | Verify 階段分離、5+軸審查、嚴重度分級、反狡辯表、安全檢查清單、效能檢查清單 |
| ⚠️ 部分 | 自動化測試（多語言支援但缺 TDD 循環和 DevTools 整合） |
| ❌ 未實作 | **Persona 系統**（三個審查人格）、**代碼簡化技能**（Chesterton's Fence + 增量簡化） |

addyosmani 的設計哲學是 **"Process over prose"** + **"Verification is mandatory"** — 每個 skill 都是**可執行的劇本**，不是參考文件。corgispec 已吸收其核心機制（反狡辯表、嚴重度分級、Verify 分離），下一步可考慮的兩個未實作項目：
1. **Persona 系統**：讓 code-reviewer/test-engineer/security-auditor 三個角色平行審查
2. **代碼簡化技能**：Chesterton's Fence 原則 + 增量簡化流程

---

Source: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
