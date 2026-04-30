[English](cross-session-memory.md) | **繁體中文**

# 跨 Session 記憶

AI coding sessions 預設是無狀態的 — 每個新 session 都從零開始。OpenSpec GitFlow 加入了 **三層記憶系統**，讓 AI agent 跨 session 保持延續性，同時控制在嚴格的 token 預算內（啟動 ~2900 tokens）。

## 問題

沒有記憶的情況下，每次 session 都在浪費 tokens 重新發現：
- 之前 session 做過什麼決策
- 之前踩過哪些坑（然後再踩一次）
- 專案有哪些隱性規則與契約
- 上一個 session 進行到哪裡

## 架構

```mermaid
graph TB
    classDef layer1 fill:#1a1a2e,stroke:#e94560,color:#fff,stroke-width:2px
    classDef layer2 fill:#16213e,stroke:#0f3460,color:#fff,stroke-width:2px
    classDef layer3 fill:#0f3460,stroke:#533483,color:#fff,stroke-width:1px
    classDef trigger fill:#533483,stroke:#533483,color:#fff,stroke-width:2px

    subgraph L1["Layer 1 — 核心記憶（每次啟動必讀, ~1300 tokens）"]
        direction LR
        MEMORY["MEMORY.md\n━━━━━━━━━━\n專案身份\n硬性約束\n偏好"]
        BRIDGE["session-bridge.md\n━━━━━━━━━━━━━━\n當前 change & 階段\n已完成 / 等待中\n新踩坑"]
        PITFALLS["pitfalls.md\n━━━━━━━━━━\n≤20 條有效\n輪替到 Archive"]
    end

    subgraph L2["Layer 2 — Wiki 知識（按需取用，透過 index 導航）"]
        direction LR
        HOT["hot.md\n━━━━━━━\n≤600 字\n活躍 changes\n近期決策\n架構脈搏"]
        INDEX["index.md\n━━━━━━━━\n≤80 行\nWikilink 導航\n所有分類"]
        subgraph PAGES["領域頁面"]
            direction TB
            ARCH["architecture/"]
            PATT["patterns/"]
            SESS["sessions/"]
            DECI["decisions/"]
            RESE["research/"]
            QUES["questions/"]
        end
    end

    subgraph L3["Layer 3 — 既有文件（不動，僅參照）"]
        DOCS["docs/ • specs/ • README"]
    end

    subgraph LIFECYCLE["寫入觸發點"]
        direction LR
        T1(["Session 啟動"])
        T2(["Apply Closeout"])
        T3(["Archive"])
        T4(["Session 結束"])
    end

    T1 -.->|"讀取 3 個檔案"| BRIDGE
    T1 -.->|"讀取"| HOT
    T1 -.->|"讀取"| INDEX

    T2 ==>|"更新"| BRIDGE
    T2 ==>|"追加"| PITFALLS
    T2 ==>|"更新"| HOT

    T3 ==>|"萃取"| PATT
    T3 ==>|"建立"| SESS
    T3 ==>|"重設"| BRIDGE

    T4 ==>|"更新"| BRIDGE

    INDEX -.->|"wikilinks"| PAGES
    PAGES -.->|"參照"| DOCS

    class MEMORY,BRIDGE,PITFALLS layer1
    class HOT,INDEX layer2
    class ARCH,PATT,SESS,DECI,RESE,QUES layer3
    class DOCS layer3
    class T1,T2,T3,T4 trigger
```

## 生命週期整合

```mermaid
sequenceDiagram
    participant H as 人類
    participant A as AI Agent
    participant M as memory/
    participant W as wiki/
    participant D as docs/

    Note over A,M: ── Session 啟動 ──
    A->>M: 讀取 session-bridge.md
    A->>W: 讀取 hot.md + index.md
    Note right of A: 合計：~2900 tokens

    Note over H,A: ── 開發 ──
    H->>A: /opsx-apply
    A->>D: 按需讀取 code & docs
    A->>W: 每個問題最多讀 2 個 wiki 頁面

    Note over A,W: ── Apply Closeout ──
    A->>M: 更新 session-bridge（Done/Waiting）
    A->>M: 追加新踩坑
    A->>W: 更新 hot.md 決策

    Note over A,W: ── Archive ──
    A->>W: 萃取 patterns → wiki/patterns/
    A->>W: 建立 session summary → wiki/sessions/
    A->>M: 重設 session-bridge
    A->>W: 移動 change 到 Recently Shipped

    Note over A,M: ── Session 結束 ──
    A->>M: 最終 session-bridge 更新
```

## 檔案結構

```
Layer 1: memory/          ← 每次啟動必讀（~1300 tokens）
├── MEMORY.md             硬性約束、專案身份（寫入一次）
├── session-bridge.md     上一個 session 的 handoff 狀態（每次 session 更新）
└── pitfalls.md           跨 change 的踩坑紀錄（追加 + 輪替）

Layer 2: wiki/            ← 按需取用，透過 index 導航（index ~700 tokens）
├── hot.md                專案脈搏，近期決策（每次 session 更新）
├── index.md              知識導航中樞，wikilinks（80 行上限）
├── architecture/         結構性洞察、隱性契約
├── patterns/             從已完成 changes 萃取的可重用模式
├── sessions/             已歸檔 changes 的歷史摘要
├── decisions/            review 階段的重要決策
├── research/             explore session 的調查結果
└── questions/            人類透過 Obsidian 提問，AI 回答

Layer 3: docs/            ← 既有專案文件（不動）
```

## 關鍵設計決策

| 決策 | 理由 |
|------|------|
| 用字數/行數上限取代 token 計數 | Skills 沒有 runtime — AI 在寫入時自行維護 |
| 分離 `memory/` 與 `wiki/` | 核心記憶（必定載入）vs 歸檔知識（按需取用）— 源自 MemGPT 研究 |
| 壓縮作為 agent 自我維護 | 沒有 cron/daemon 可用 — agent 在正常寫入時自行壓縮 |
| Lint 是獨立工具，不是閘門 | 永遠不會阻擋工作流；透過 `/opsx-lint` 定期健康檢查 |
| Ask 使用 early-stop 檢索 | 預算感知：每個問題最多 2 個 wiki 頁面，找到足夠資訊即停止 |

## 檔案大小上限

記憶透過硬性上限自動壓縮。AI agent 在寫入時自行維護這些上限；`/opsx-lint` 事後驗證：

| 檔案 | 目標 | 硬性上限 | 超限動作 |
|------|------|----------|----------|
| `wiki/hot.md` | 500 字 | 600 字 | 刪除最舊的 entries |
| `wiki/index.md` | 40 行 | 80 行 | 歸檔已完成的 entries |
| `memory/pitfalls.md` | 10 條有效 | 20 條有效 | 最舊 10 條輪替到 Archive |
| `memory/session-bridge.md` | 30 行 | 50 行 | 歸檔舊的 Done 項目 |

## 如何開始使用

### 新專案

在 `/opsx-install` 過程中自動初始化記憶（用 `--no-memory` 可跳過）：

```text
/opsx-install --path /path/to/project
# Installer 會問："Initialize memory structure? (yes/no — default: yes)"
```

### 既有專案（無先前知識）

為已使用 OpenSpec 的專案加入記憶：

```text
/opsx-memory-init
```

### 既有專案且有累積知識

把 docs、已歸檔 changes 和 vault 頁面遷移進記憶結構：

```text
/opsx-migrate
```

Migrate skill 分 4 個階段執行：

1. **Agent Config 深化**（自動）— 從 CLAUDE.md/AGENTS.md 萃取約束到 `memory/MEMORY.md`
2. **已歸檔 Changes**（自動）— 從 `openspec/changes/archive/` 產生 session summaries 與 patterns
3. **docs/ 目錄**（混合）— 自動分類明確的文件，對模糊的詢問使用者
4. **Vault 頁面**（混合）— 呈現找到的 .md 檔案讓使用者分類

遷移永遠不會移動或刪除來源檔案 — 只會建立 wiki entries 來參照原始文件。

## Obsidian 相容性

所有記憶檔案都是合法的 markdown + `[[wikilinks]]`。如果你的專案也是 Obsidian vault：
- `wiki/` 會渲染成可導航的知識圖譜
- `memory/` 可一覽 session 狀態
- 人類可以直接瀏覽、搜尋、甚至編輯記憶檔案
- `/opsx-ask` 可回答在 vault 中建立的 pending .md 問題檔

## 相關指令

| 指令 | 用途 |
|------|------|
| `/opsx-memory-init` | 初始化三層記憶結構 |
| `/opsx-migrate` | 匯入既有知識到 memory/wiki |
| `/opsx-lint` | 驗證記憶健康度（11 項檢查） |
| `/opsx-ask` | 使用預算感知檢索回答問題 |

## 延伸閱讀

- [設計文件](../openspec/changes/openspec-llm-memory/design.md) — 架構決策、風險、權衡
- [提案](../openspec/changes/openspec-llm-memory/proposal.md) — 動機與範圍
- 研究參考：MemGPT、GenericAgent、xMemory
