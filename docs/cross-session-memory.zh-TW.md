[English](cross-session-memory.md) | **繁體中文**

# RFC-first 跨 Session 記憶

CorgiSpec v4 將 RFC 治理、長期知識與即時交付狀態分開：

- RFC 定義已接受的目標、邊界、Slice 與驗收條件。
- Wiki 保存研究、已驗證架構、可重用模式、ADR、指南、問題與交付結果。
- Memory 保存永久約束與跨 Session 的 durable checkpoint。
- `.corgi/loop` 是唯一的即時生命週期權威。

Memory/Wiki 是強制結構。Fresh bootstrap 以交易方式建立；v4 遷移保留既有使用者知識。

## 結構

```text
memory/
├── MEMORY.md             有來源的永久約束
├── session-bridge.md      交付 checkpoint mirror
└── pitfalls.md            已驗證的跨交付踩坑

wiki/
├── hot.md                 精簡的目前專案脈搏
├── index.md               按需導航
├── schema.md              頁面契約與 ownership markers
├── architecture/           已驗證的目前系統
├── research/               證據與假設
├── patterns/               已驗證的可重用方法
├── decisions/              accepted RFC 範圍內的 ADR
├── guides/                 已驗證的操作指南
├── questions/              人類問答
├── deliveries/             已歸檔 RFC Slice 結果
└── meta/                   明確要求產生的報告
```

遷移時會原地保留既有 `wiki/sessions/` 與 `wiki/log.md` 作為 legacy read-only 資料。Fresh 專案不建立它們，現行 workflow 也不會追加內容。

## 啟動順序

每個 Agent 固定先讀三個檔案：

1. `memory/session-bridge.md`
2. `memory/MEMORY.md`
3. `wiki/hot.md`

接著讀取 bridge 指向的 RFC/Slice 與 Change overlays。只有需要領域知識時才讀 `wiki/index.md`。

SessionStart 與 PostCompact hooks 從 `.corgi/loop` 合成目前 phase、Task Group、run revision 與 next action。Bridge 不一致時只回報 drift；bridge 永遠不能覆蓋 Run Contract。

## 寫入邊界

| 位置 | 允許寫入 |
|---|---|
| `MEMORY.md` | 人類接受的永久約束，或已提升的驗證知識；必須附來源 |
| `session-bridge.md` | Planning baseline 與每個 Task Group commit 前；Archive closeout 僅由 `corgispec archive --local` 寫入 |
| `pitfalls.md` | 有證據與補救方法的已驗證失敗模式 |
| `architecture/` | 由最終 source 與 accepted delivery evidence 驗證的目前行為 |
| `research/` | 調查與尚未驗證的發現 |
| `deliveries/` | 每個 archived RFC Slice 一頁 immutable closeout |

工具只能修改成對 `corgi:managed` markers 之間的內容；markers 外的人類文字必須保留。

RFC Slice closeout 時，只有 `corgispec archive --local` 可以寫入 archive-derived 的 delivery page，以及 `hot`、`architecture`、`patterns`、`MEMORY.md`、`pitfalls.md` 和 archive bridge checkpoint 的提升 provenance。Skill 可以在執行前 read-only 地整理 candidate，或在完成後驗證結果；closeout commit 封存後絕不能再寫入第二份 closeout。

## 交付 Closeout

只有成功的 `corgispec archive --local` 會建立 `wiki/deliveries/<RFC-ID>-<Slice-ID>.md` 與 archive-derived knowledge updates，內容包括：

- 已交付邊界與結果；
- 每個 AC 的自動化/人工證據；
- Task Group commits 與 final HEAD；
- Human Review 與 Human QA 結果；
- 提升的 architecture、patterns、pitfalls 或永久約束；
- RFC、archived Change、evidence manifest 與單一 Issue 連結。

未驗證發現留在 Research 或 Session Bridge Promotion Queue。

## Ask 與 Lint

`/corgi-ask` 採 early-stop retrieval：三個啟動檔案後，最多再讀兩個相關 Wiki 頁面；question 以外總共最多五個 context files。它會引用來源並加入 promotion candidate，不會把回答直接提升到 Architecture、Pitfalls、Patterns、Decisions 或 MEMORY。

`/corgi-lint` 執行 14 項檢查，預設完全 read-only。只有 `/corgi-lint --report` 會把報告寫到 `wiki/meta/`；lint 永不自動修正知識檔案。

## 大小限制

| 檔案 | 目標 | 硬上限 |
|---|---:|---:|
| `wiki/hot.md` | 500 字 | 600 字 |
| `wiki/index.md` | 40 行 | 80 行 |
| `memory/pitfalls.md` | 10 條 active | 20 條 active |
| `memory/session-bridge.md` | 30 行 | 50 行 |

## 建立與遷移

```text
# Fresh project 或 managed update
corgispec bootstrap

# 明確執行 v3 → v4 cutover
corgispec bootstrap --migrate-v4

# Bootstrap 後進行有來源的知識豐富化
/corgi-migrate

# Read-only 健康檢查
/corgi-lint
```

遷移不會自動接受 RFC。既有文件與 archived changes 可作為 Foundation RFC 或 Research 的來源，但 RFC 仍須由人類 review、accept 並 merge。
