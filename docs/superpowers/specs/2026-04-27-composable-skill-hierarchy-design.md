# 可組合技能層級架構設計：Atoms → Molecules → Compounds

**日期：** 2026-04-27
**來源：** Shiv Sakhuja (@shivsakhuja) — [X Article](https://x.com/shivsakhuja/status/2047124337191444844), 2026-04-23
**參考實作：** [gooseworks-ai/goose-skills](https://github.com/gooseworks-ai/goose-skills) (475★, 108 skills)

---

## 背景

### 現行 Agent Skills 標準的限制

Anthropic 的 Agent Skills 開放標準採用**扁平結構**——每個 skill 都是對等的資料夾，內含 `SKILL.md` 和可選資源。這在 skill 數量少時運作良好，但隨著規模擴大會出現問題：

- **Skill 爆炸**：100+ 個扁平 skill 全部競爭 context window
- **缺乏組合性**：skill 之間沒有正式的呼叫/依賴關係
- **重複勞動**：每個複合工作流都得從頭寫，無法複用原子能力

### 深度 Skill Graph 為什麼行不通

直覺上，讓 skill 任意互相呼叫（像 Obsidian 知識圖譜一樣）似乎很自然。但 Shiv 的實務經驗指出，當依賴深度增加時，這種「自由圖」模式會崩壞：

| 失敗模式 | 說明 |
|---|---|
| **非確定性累積** | 每個節點都是 agent 的決策點，錯誤機率隨深度指數增長 |
| **執行深度不確定** | Agent 無法預知 chain 會走多深 |
| **循環依賴風險** | A → B → C → A 形成死循環 |
| **判斷力過度委託** | 每一跳都把「該不該呼叫」的決定權交給 agent |

單層 `Skill A → Skill B` 通常沒問題。問題出在**深度 ≥ 3 和密度高**的圖。

---

## 核心提案：三層組合模型

將深度限制在**恰好三層**，用化學隱喻命名：

```
Compounds（化合物）  ← 人類操作層
    ↓ 編排 8-10 個
Molecules（分子）    ← 顯式工作流層
    ↓ 串接 2-10 個
Atoms（原子）        ← 原始能力層
```

### 第一層：Atoms（原子）= Capabilities

**定義：** 單一用途、窄範圍、不可再分的原始技能。

**特性：**

| 屬性 | 要求 |
|---|---|
| 職責 | 做好一件事 |
| 可靠性 | 接近確定性（近乎 100% 成功率） |
| 是否呼叫其他 skill | **否** — 原子是葉節點 |
| 輸入/輸出 | 明確定義，可預測 |
| 失敗處理 | 快速失敗，錯誤訊息清晰 |

**範例：**

| Atom | 做什麼 |
|---|---|
| `scrape-linkedin-profile` | 抓取一個 LinkedIn 個人頁面 |
| `find-person-on-apollo` | 用 Apollo API 找一個人 |
| `verify-email-hunter` | 用 Hunter.io 驗證 email |
| `review-pr` | 審查一個 Pull Request |
| `blog-feed-monitor` | 透過 RSS 抓取部落格更新 |
| `meta-ad-scraper` | 抓取 Meta 廣告素材 |

**設計原則：**
- 原子**永遠不呼叫其他 skill** — 這是最核心的約束
- 如果一個 atom 需要拆分，它就不是 atom
- 原子是可被任何 molecule 複用的積木

---

### 第二層：Molecules（分子）= Composites

**定義：** 中層技能，透過串接 2–10 個 atoms 來解決一個有明確邊界的問題。

**特性：**

| 屬性 | 要求 |
|---|---|
| 職責 | 解決一個有界問題（bounded problem） |
| 組合方式 | **顯式的** — 分子本身宣告何時、如何呼叫哪些 atom |
| Agent 判斷空間 | 最小化 — 組合邏輯寫死在 SKILL.md 裡，不是 runtime 決定 |
| Atom 數量 | 2–10 個 |
| 是否呼叫其他 molecule | **否** — 分子不呼叫分子 |

**關鍵洞察：組合邏輯下沉到 skill 本身**

傳統做法是讓 agent 在 runtime 決定「接下來該呼叫哪個 skill」。Molecule 模式的核心區別是：**組合邏輯被推入分子的 SKILL.md 中**。Agent 不需要判斷——它照著 SKILL.md 的步驟走。

```markdown
# lead-qualification（分子）

## 步驟

1. 呼叫 `find-person-on-apollo` — 取得候選人清單
2. 呼叫 `verify-email-hunter` — 驗證每個人的 email
3. 根據 ICP 標準打分
4. 輸出合格名單到 CSV

## 原子依賴
- find-person-on-apollo
- verify-email-hunter
```

**分子的兩種形態：**

| 形態 | 說明 | 適用場景 |
|---|---|---|
| **嚴格序列** | Atom A → B → C → D，固定順序 | 流程明確、無分支 |
| **有限編排** | 小型 orchestrator，有少量判斷邏輯 | 需要簡單條件分支（如「如果 email 無效就跳過」） |

**範例：**

| Molecule | 串接的 Atoms | 做什麼 |
|---|---|---|
| `competitor-intel` | reddit + twitter + linkedin + blog scrapers | 綜合競爭情報 |
| `lead-qualification` | find leads → verify → score | 線索驗證與評分 |
| `leadership-change-outreach` | detect → evaluate → enrich → draft | 高管變動偵測+外聯 |

---

### 第三層：Compounds（化合物）= Playbooks

**定義：** 高層編排器，運行多個 molecules 完成端到端的業務流程。

**特性：**

| 屬性 | 要求 |
|---|---|
| 職責 | 端到端工作流 |
| Agent 自主性 | **高** — 這是 agent 獲得真正自主權的層級 |
| 確定性 | 先天較低 — 因為跨多個分子的編排涉及更多判斷 |
| 人類角色 | 今天仍需人類駕駛（human driver） |
| Molecule 數量 | 推薦上限 8–10 個 |

**範例：**

| Compound | 編排的 Molecules | 做什麼 |
|---|---|---|
| `outbound-prospecting-engine` | signal detection → research → qualify → contact → personalize → campaign | 完整外銷開發流程 |
| `event-prospecting-pipeline` | find attendees → research → qualify → dedup → outreach | 活動場景線索挖掘 |
| `feature-launch-playbook` | brief → content → graphics → distribution | 功能上線全套物料 |

---

## 槓桿模型：為什麼三層能放大人類產出

核心論點是關於**人類的「大腦 RAM」**——context switching 和管理多個 agent 是真正的瓶頸。

### 數學模型

```
1 Compound ≈ 編排 ~10 Molecules
1 Molecule ≈ 串接 ~10 Atoms
─────────────────────────────────
1 人管理 Compounds = 撬動 ~100 個原子級任務
```

### 注意力分配原則

| 層級 | 人類注意力 | 原因 |
|---|---|---|
| Atoms | **零** | 近乎確定性，不需要監督 |
| Molecules | **極低** | 顯式工作流，失敗時快速報錯 |
| Compounds | **高** | 這裡才需要人類判斷 |

**結論：** 人類應該**只在 Compound 層級操作**。把確定性的低層工作全部交給 skill 自己處理，人類的判斷力集中在高層的「做不做」和「做什麼」。

---

## 可靠性邊界

Shiv 自己承認的已知限制：

| 邊界 | 描述 |
|---|---|
| **Compound 上限** | 單個 compound 編排超過 ~8-10 個 molecules 時，可靠性開始下降 |
| **跨 Compound 編排** | 目前沒有定義「Compound 的 Compound」，因為那又回到了深度圖的問題 |
| **Agent 判斷上限** | Compound 層級的 agent 自主性仍受限於當前模型能力 |

---

## 檔案結構：雙檔案契約

每個 skill 目錄必須包含兩個檔案：

```
skill-name/
├── SKILL.md           # Agent/人類可讀的指令文件
└── skill.meta.json    # 機器可讀的元資料
```

### SKILL.md

遵循 Agent Skills 開放標準的格式：

```markdown
---
type: capability | composite | playbook
name: skill-slug
description: >
  一句話描述這個 skill 做什麼、什麼時候用。
---

# Skill 名稱

## 用途
...

## 步驟（Molecules/Playbooks 才有）
1. 呼叫 `atom-a` — 做 X
2. 呼叫 `atom-b` — 做 Y
...

## 原子依賴（Molecules 才有）
- atom-a
- atom-b
```

### skill.meta.json

```json
{
  "slug": "skill-slug",
  "category": "capabilities | composites | playbooks",
  "tags": ["tag1", "tag2"],
  "installation": {
    "base_command": "npx gooseworks install skill-slug",
    "supports": ["claude", "codex", "cursor"]
  },
  "depends_on": ["atom-a", "atom-b"],
  "author": "author-name"
}
```

**為什麼要雙檔案？**

| 檔案 | 消費者 | 用途 |
|---|---|---|
| `SKILL.md` | Agent + 人類 | 執行指令、progressive disclosure |
| `skill.meta.json` | 工具鏈 | 安裝、驗證、索引、依賴分析 |

`SKILL.md` 是 agent 在 runtime 讀取的東西。`skill.meta.json` 是 CLI 工具、linter、registry 在 build time 用的東西。分離兩者讓每一邊都能獨立演化。

---

## 層級約束規則（不可違反）

這些是整個模型的硬性約束：

| 規則 | 說明 |
|---|---|
| **Atom 不呼叫 Atom** | 原子是葉節點，自包含 |
| **Atom 不呼叫 Molecule** | 禁止向上依賴 |
| **Molecule 只呼叫 Atom** | 分子只能向下一層 |
| **Molecule 不呼叫 Molecule** | 禁止同層依賴（避免隱式深度） |
| **Compound 只呼叫 Molecule** | 化合物只能向下一層 |
| **Compound 不呼叫 Atom** | 禁止跨層（必須經過 Molecule） |
| **Compound 不呼叫 Compound** | 禁止同層依賴（避免回到深度圖） |
| **最大深度 = 3** | Compound → Molecule → Atom，不能更深 |

```
✅ Compound → Molecule → Atom     （合法）
✅ Molecule → Atom                 （合法）
✅ Atom                            （合法，獨立運行）
❌ Compound → Atom                 （非法，跨層）
❌ Molecule → Molecule             （非法，同層）
❌ Compound → Compound             （非法，同層）
❌ Atom → Molecule                 （非法，向上依賴）
```

---

## 與現有模式的比較

### vs. 扁平 Skills（Anthropic 標準）

| 維度 | 扁平 Skills | 三層模型 |
|---|---|---|
| 結構 | 所有 skill 對等 | 嚴格三層 |
| 組合性 | 無正式機制 | Molecule 顯式串接 Atom |
| 擴展性 | Skill 數量增長 → context 壓力 | 層級索引，只載入需要的層 |
| 進入門檻 | 低 | 中（需要理解三層分類） |
| 適用規模 | < 30 skills | 30-500+ skills |

### vs. 深度 Skill Graph

| 維度 | 深度圖 | 三層模型 |
|---|---|---|
| 深度 | 無限制 | 硬性上限 3 |
| 靈活性 | 最高 | 受限但足夠 |
| 可靠性 | 隨深度衰減 | 可預測 |
| Debug 難度 | 困難（路徑不確定） | 容易（層級清晰） |
| 循環風險 | 高 | 零（層級約束消除循環） |

### vs. 我們現有的 OpenSpec GitFlow Skills

| 維度 | 現有結構 | 三層模型可能的改進 |
|---|---|---|
| 組織方式 | 按功能命名的扁平 skill 目錄 | 按層級分類 + 功能命名 |
| 組合方式 | Skill 內部引用其他 skill（隱式） | 顯式 `depends_on` + 層級約束 |
| 元資料 | YAML frontmatter 在 SKILL.md | 額外 `skill.meta.json` 分離關注點 |
| 安裝 | `install-skills.sh` 全量複製 | 可按需安裝特定層級 |

---

## 已知開放問題

1. **Compound 的 Compound？** 當業務流程確實需要 4 層以上時怎麼辦？Shiv 沒有答案——他認為這回到了深度圖的問題，目前建議是「拆分成多個獨立 Compound，由人類手動串接」。

2. **跨 Molecule 共享狀態** 多個 Molecule 需要共享中間結果時（如一個抓資料，另一個用同一份資料做分析），狀態傳遞機制不明確。Gooseworks 似乎用 CSV/spreadsheet 作為隱式共享介面。

3. **動態路由** 如果一個 Compound 需要根據運行時結果決定呼叫哪個 Molecule（而不是固定序列），判斷邏輯放哪裡？目前 Compound 的 SKILL.md 本身承擔了這個角色，但沒有正式的 routing DSL。

4. **版本相容性** Atom 升級 API 時，依賴它的 Molecules 是否自動適配？目前沒有版本約束機制。

5. **測試策略** 如何測試 Molecule 是否正確串接 Atoms？Gooseworks 有 `validate-skills.js` 但只做結構驗證，不做行為測試。[skillkit](https://github.com/sakhilchawla/skillkit) 專案正在嘗試解決這個問題。

---

## 結論

三層 Atoms → Molecules → Compounds 模型的核心洞察是：

> **組合性不是 agent 的 runtime 判斷問題，而是 skill 的 design-time 結構問題。**

把「什麼呼叫什麼」的決定從 agent 的 runtime 推回到 skill 作者的 design-time，就能在保持組合性的同時維持可靠性。深度限制在 3 層、每層 ~10 個下游、禁止同層和向上依賴——這些硬性約束看似限制了靈活性，但實際上消除了深度圖的全部失敗模式。

這是一個值得認真評估的架構模式，尤其當 skill 庫規模超過 30 個時。
