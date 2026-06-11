# OpenSpec Skill 三層重構設計

**日期：** 2026-04-27
**方案：** Bottom-Up 抽取（方案 A）
**範圍：** OpenSpec lifecycle skills（11 個 → 7 atoms + 6 molecules）
**前置文件：** [可組合技能層級架構設計](2026-04-27-composable-skill-hierarchy-design.md)

---

## 目標與優先級

| 優先級 | 目標 | 定義 |
|---|---|---|
| P0 | **向後相容** | 重構期間 `/corgi-*` 命令和 `install-skills.sh` 持續正常運作 |
| P1 | **工具鏈基礎設施** | 建立 `skill.meta.json` schema、驗證工具、CLI |
| P2 | **複用性** | 抽取共用操作成 atoms，消除 GitLab/GitHub 重複 |

### 非目標

- 重構 GitLab issue-phase skills（12 個）— 留給後續階段
- 建立 skill marketplace 或 registry — 超出範圍
- 改變 OpenSpec CLI 本身的行為

---

## 現狀分析

### 現有 skill 清單（11 個唯一 skills，跨 .opencode/.claude/.codex 鏡像）

| Skill | Platform | 現有分類 | 主要職責 |
|---|---|---|---|
| `corgispec-install` | universal | Atom | 驗證 prerequisites，複製 managed fileset |
| `corgispec-explore` | gitlab | Atom | Read-only context mode |
| `corgispec-gh-explore` | github | Atom | Read-only context mode |
| `corgispec-propose` | gitlab | Molecule | 產生 artifacts + 建立 GitLab issues |
| `corgispec-gh-propose` | github | Molecule | 產生 artifacts + 建立 GitHub issues |
| `corgispec-apply-change` | gitlab | Molecule | 執行一個 Task Group checkpoint |
| `corgispec-gh-apply` | github | Molecule | 執行一個 Task Group checkpoint |
| `corgispec-review` | gitlab | Molecule | Quality checks + human gate |
| `corgispec-gh-review` | github | Molecule | Quality checks + human gate |
| `corgispec-archive-change` | gitlab | Atom | Close issues + move to archive |
| `corgispec-gh-archive` | github | Atom | Close issues + move to archive |

### 現有問題

1. **GitLab/GitHub 重複**：6 個 lifecycle phases × 2 platforms = 12 個 SKILL.md，~90% 邏輯重複
2. **無正式元資料**：無 `skill.meta.json`，依賴關係隱式存在於 SKILL.md 文字中
3. **無驗證工具**：skill 目錄結構和依賴合法性無自動化檢查
4. **共用操作分散**：config 解析、worktree 偵測、issue sync、tasks 解析等操作散佈在多個 skills 內

### 現有 Reference Docs（影響 atom 設計）

| Reference | 所屬 Skill | 提取為 |
|---|---|---|
| `artifact-creation.md` | corgispec-propose | → `corgispec-cli-runner` atom 內化 |
| `gitlab-issues.md` | corgispec-propose | → `sync-issue-gl` atom |
| `checkpoint-flow.md` | corgispec-apply-change, corgispec-gh-apply | → `parse-tasks` + molecule 流程 |
| `delegation-strategy.md` | corgispec-apply-change, corgispec-gh-apply | → 留在 `corgi-apply` molecule 內 |
| `issue-sync.md` | corgispec-apply-change, corgispec-gh-apply | → `sync-issue-gl`, `sync-issue-gh` atoms |
| `worktree-discovery.md` | 8/11 skills（apply, gh-apply, review, gh-review, explore, gh-explore, archive-change, gh-archive） | → `resolve-worktree` atom |
| `quality-checks.md` | corgispec-review（注意：gh-review 缺此檔案） | → 留在 `corgi-review` molecule 內 |
| `review-decisions.md` | corgispec-review（注意：gh-review 缺此檔案） | → 留在 `corgi-review` molecule 內 |
| `repair-flow.md` | corgispec-review（注意：gh-review 缺此檔案） | → 留在 `corgi-review` molecule 內 |

**現有不一致：** `corgispec-gh-review` 缺少 `quality-checks.md`、`review-decisions.md`、`repair-flow.md`（可能 inlined 在 SKILL.md 中）。合併為 `corgi-review` molecule 時統一補全。

**鏡像不一致：** `.codex/skills/` 缺少 `corgispec-install`（10/11 skills）。Phase 4 清理時一併修正。

---

## 目錄結構

### Before（扁平）

```
.opencode/skills/
├── corgispec-apply-change/          # GitLab apply
│   ├── SKILL.md
│   └── references/
│       ├── checkpoint-flow.md
│       ├── issue-sync.md
│       └── worktree-discovery.md
├── corgispec-gh-apply/              # GitHub apply（~90% 重複）
│   ├── SKILL.md
│   └── references/
│       └── issue-sync.md
├── corgispec-propose/               # GitLab propose
├── corgispec-gh-propose/            # GitHub propose（~90% 重複）
├── corgispec-review/                # GitLab review
├── corgispec-gh-review/             # GitHub review（~90% 重複）
├── corgispec-archive-change/        # GitLab archive
├── corgispec-gh-archive/            # GitHub archive（~90% 重複）
├── corgispec-explore/               # GitLab explore
├── corgispec-gh-explore/            # GitHub explore（~90% 重複）
└── corgispec-install/               # universal install
```

### After（分層）

```
.opencode/skills/
├── atoms/
│   ├── resolve-config/
│   │   ├── SKILL.md
│   │   └── skill.meta.json
│   ├── resolve-worktree/
│   │   ├── SKILL.md
│   │   └── skill.meta.json
│   ├── corgispec-cli-runner/
│   │   ├── SKILL.md
│   │   └── skill.meta.json
│   ├── parse-tasks/
│   │   ├── SKILL.md
│   │   └── skill.meta.json
│   ├── sync-issue-gh/
│   │   ├── SKILL.md
│   │   └── skill.meta.json
│   ├── sync-issue-gl/
│   │   ├── SKILL.md
│   │   └── skill.meta.json
│   └── generate-rich-summary/
│       ├── SKILL.md
│       └── skill.meta.json
│
├── molecules/
│   ├── corgi-propose/
│   │   ├── SKILL.md
│   │   ├── skill.meta.json
│   │   └── references/              # 從舊 skills 合併過來
│   │       └── artifact-creation.md
│   ├── corgi-apply/
│   │   ├── SKILL.md
│   │   ├── skill.meta.json
│   │   └── references/
│   │       ├── checkpoint-flow.md
│   │       └── delegation-strategy.md
│   ├── corgi-review/
│   │   ├── SKILL.md
│   │   ├── skill.meta.json
│   │   └── references/
│   │       ├── quality-checks.md
│   │       ├── review-decisions.md
│   │       └── repair-flow.md
│   ├── corgi-archive/
│   │   ├── SKILL.md
│   │   └── skill.meta.json
│   ├── corgi-explore/
│   │   ├── SKILL.md
│   │   └── skill.meta.json
│   └── corgi-install/
│       ├── SKILL.md
│       └── skill.meta.json
│
└── compounds/                       # Phase 1 為空，留給 GitLab issue-phase
```

**鏡像規則：** `.claude/skills/` 和 `.codex/skills/` 維持與 `.opencode/skills/` 相同的結構。CLI 負責同步。

---

## skill.meta.json Schema

### JSON Schema 定義

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ds-internal-skills/skill-meta.schema.json",
  "type": "object",
  "required": ["slug", "tier", "version", "description", "depends_on", "platform", "installation"],
  "properties": {
    "slug": {
      "type": "string",
      "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$",
      "description": "唯一 kebab-case 識別符"
    },
    "tier": {
      "enum": ["atom", "molecule", "compound"],
      "description": "層級分類"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "語意版本號"
    },
    "description": {
      "type": "string",
      "maxLength": 200,
      "description": "一句話描述"
    },
    "depends_on": {
      "type": "array",
      "items": { "type": "string" },
      "description": "依賴的 skill slugs"
    },
    "platform": {
      "enum": ["universal", "github", "gitlab"],
      "description": "平台適用範圍"
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "分類標籤"
    },
    "installation": {
      "type": "object",
      "required": ["targets", "base_path"],
      "properties": {
        "targets": {
          "type": "array",
          "items": { "enum": ["opencode", "claude", "codex"] }
        },
        "base_path": {
          "type": "string",
          "description": "相對於 skills root 的路徑"
        }
      }
    }
  }
}
```

### 層級約束規則

| 規則 | 驗證條件 | 違反時的錯誤 |
|---|---|---|
| Atom 無依賴 | `tier == "atom"` → `depends_on == []` | `ERROR: Atom '{slug}' must not have dependencies` |
| Molecule 只依賴 Atom | `tier == "molecule"` → 所有 `depends_on` 的 tier 都是 `atom` | `ERROR: Molecule '{slug}' depends on non-atom '{dep}'` |
| Compound 只依賴 Molecule | `tier == "compound"` → 所有 `depends_on` 的 tier 都是 `molecule` | `ERROR: Compound '{slug}' depends on non-molecule '{dep}'` |
| 無循環 | 依賴圖是 DAG | `ERROR: Circular dependency detected: {cycle}` |
| 平台相容 | github atom 不被 gitlab molecule 依賴 | `ERROR: '{mol}' (gitlab) depends on '{atom}' (github)` |
| Slug 一致 | `skill.meta.json` 的 `slug` == `SKILL.md` frontmatter 的 `name` | `ERROR: Slug mismatch in '{dir}'` |
| 依賴存在 | `depends_on` 的每個 slug 都有對應目錄 | `ERROR: '{slug}' depends on unknown skill '{dep}'` |

---

## Atom 規格

### Atom 1: `resolve-config`

| 屬性 | 值 |
|---|---|
| **slug** | `resolve-config` |
| **tier** | `atom` |
| **platform** | `universal` |
| **職責** | 讀取 `openspec/config.yaml`，回傳 schema、platform、isolation config |
| **輸入** | 專案根目錄路徑（預設 cwd） |
| **輸出** | `{ schema: string, platform: "github"\|"gitlab", isolation: { mode, root, branch_prefix } }` |
| **失敗條件** | config.yaml 不存在、schema 欄位缺失 |
| **depends_on** | `[]` |

**從何抽取：** 每個 `/corgi-*` command wrapper 的開頭都做 config 解析。抽取後 command wrapper 變成純 dispatch，config 邏輯集中在 atom。

### Atom 2: `resolve-worktree`

| 屬性 | 值 |
|---|---|
| **slug** | `resolve-worktree` |
| **tier** | `atom` |
| **platform** | `universal` |
| **職責** | 偵測是否在 worktree 中，找到 change dir 和 branch |
| **輸入** | 專案根目錄、optional change name |
| **輸出** | `{ in_worktree: bool, worktree_path: string\|null, change_dir: string, branch: string\|null }` |
| **失敗條件** | change dir 不存在 |
| **depends_on** | `[]` |

**從何抽取：** `corgispec-apply-change/references/worktree-discovery.md`。目前 apply/review/archive/explore 四個 phase 都有各自的 worktree 解析邏輯。

### Atom 3: `corgispec-cli-runner`

| 屬性 | 值 |
|---|---|
| **slug** | `corgispec-cli-runner` |
| **tier** | `atom` |
| **platform** | `universal` |
| **職責** | 封裝 `openspec` CLI 呼叫 |
| **支援子命令** | `new change`、`status`、`instructions`、`list` |
| **輸入** | 子命令 + 參數 |
| **輸出** | `{ stdout: string, stderr: string, exitCode: number }` |
| **失敗條件** | `openspec` 未安裝、非零 exit code |
| **depends_on** | `[]` |

**從何抽取：** propose 和 apply 都直接呼叫 openspec CLI。抽取後可統一錯誤處理和 output parsing。

### Atom 4: `parse-tasks`

| 屬性 | 值 |
|---|---|
| **slug** | `parse-tasks` |
| **tier** | `atom` |
| **platform** | `universal` |
| **職責** | 解析 `tasks.md`，提取 Task Groups 結構和完成狀態 |
| **輸入** | `tasks.md` 檔案路徑 |
| **輸出** | `{ groups: [{ number: int, name: string, tasks: [{ text: string, done: bool }], status: "pending"\|"in_progress"\|"review"\|"done" }] }` |
| **失敗條件** | 檔案不存在、格式不符 `## N. Name` 結構 |
| **depends_on** | `[]` |

**從何抽取：** apply 需要找 pending group，review 需要讀 completed group，archive 需要檢查未完成任務。三個 phase 都在做 tasks.md 解析。

### Atom 5: `sync-issue-gh`

| 屬性 | 值 |
|---|---|
| **slug** | `sync-issue-gh` |
| **tier** | `atom` |
| **platform** | `github` |
| **職責** | GitHub issue CRUD via `gh` CLI |
| **支援操作** | `create-parent`、`create-children`、`update-body`、`add-comment`、`add-label`、`remove-label`、`close`、`reopen` |
| **輸入** | operation type + issue data (title, body, labels, etc.) |
| **輸出** | `{ issue_number: int, url: string, operation: string, success: bool }` |
| **失敗條件** | `gh` 未安裝、auth 失敗、API 錯誤 |
| **depends_on** | `[]` |

**從何抽取：** `corgispec-gh-propose`、`corgispec-gh-apply`、`corgispec-gh-review`、`corgispec-gh-archive` 都在做 GitHub issue 操作。四個 skills 的 issue 邏輯合併為一個 atom。

### Atom 6: `sync-issue-gl`

| 屬性 | 值 |
|---|---|
| **slug** | `sync-issue-gl` |
| **tier** | `atom` |
| **platform** | `gitlab` |
| **職責** | GitLab issue CRUD via `glab` CLI |
| **支援操作** | 同 `sync-issue-gh`，加上 `workflow::` label 格式 |
| **輸入** | 同 `sync-issue-gh` |
| **輸出** | 同 `sync-issue-gh` |
| **失敗條件** | `glab` 未安裝、auth 失敗、API 錯誤 |
| **depends_on** | `[]` |

**從何抽取：** `corgispec-propose`、`corgispec-apply-change`、`corgispec-review`、`corgispec-archive-change` 的 GitLab issue 操作。

### Atom 7: `generate-rich-summary`

| 屬性 | 值 |
|---|---|
| **slug** | `generate-rich-summary` |
| **tier** | `atom` |
| **platform** | `universal` |
| **職責** | 產生 Task Group 的 rich summary markdown |
| **輸入** | `{ group_name, group_number, objectives, tasks_completed, tasks_total, files_produced: string[], notes: string }` |
| **輸出** | formatted markdown string |
| **失敗條件** | 無（純轉換函式） |
| **depends_on** | `[]` |

**從何抽取：** apply 完成時產生 summary 貼到 issue，review 產生 report。格式一致但目前各自實作。

---

## Molecule 規格

### Molecule 1: `corgi-propose`

```json
{
  "slug": "corgi-propose",
  "tier": "molecule",
  "depends_on": ["resolve-config", "resolve-worktree", "corgispec-cli-runner",
                  "parse-tasks", "sync-issue-gh", "sync-issue-gl"],
  "platform": "universal"
}
```

**流程：**

1. `resolve-config` → 取得 `{ schema, platform, isolation }`
2. 如果 `isolation.mode == "worktree"` → `resolve-worktree` 建立/切換 worktree
3. `corgispec-cli-runner` → `openspec new change <name>`
4. 循環 `corgispec-cli-runner` → `openspec status` + `openspec instructions` 依序產生：
   - `proposal.md` → `specs/**` → `design.md` → `tasks.md`
5. `parse-tasks` → 驗證 tasks.md 格式正確
6. **Platform dispatch：**
   - 如果 `platform == "github"` → `sync-issue-gh`：create-parent + create-children
   - 如果 `platform == "gitlab"` → `sync-issue-gl`：create-parent + create-children
7. 寫入 `.github.yaml` 或 `.gitlab.yaml` handoff state
8. 如果 worktree → 寫入 `.worktree.yaml`
9. **輸出：** Planning package complete，提示使用者執行 `/corgi-apply`

**合併來源：** `corgispec-propose` + `corgispec-gh-propose`

### Molecule 2: `corgi-apply`

```json
{
  "slug": "corgi-apply",
  "tier": "molecule",
  "depends_on": ["resolve-config", "resolve-worktree", "corgispec-cli-runner",
                  "parse-tasks", "sync-issue-gh", "sync-issue-gl",
                  "generate-rich-summary"],
  "platform": "universal"
}
```

**流程：**

1. `resolve-config` + `resolve-worktree` → 定位 change
2. `corgispec-cli-runner` → `openspec instructions apply`
3. `parse-tasks` → 找第一個 status == "pending" 的 Task Group
4. **Platform dispatch** → `sync-issue-gh/gl`：child issue → `in-progress` label
5. **實作該 group**（agent 的真正工作 — 不是 atom 行為）
6. 更新 `tasks.md`，把完成的 tasks 標記 `[x]`
7. `parse-tasks` → 驗證更新後狀態
8. `generate-rich-summary` → 產生完成摘要
9. **Platform dispatch** → `sync-issue-gh/gl`：add-comment(summary) + child issue → `review`
10. 更新 parent issue 進度
11. **輸出：** Checkpoint complete，STOP，提示使用者執行 `/corgi-review`

**硬性約束：** 每次只執行一個 Task Group。不允許跨 group 執行。

**合併來源：** `corgispec-apply-change` + `corgispec-gh-apply`

### Molecule 3: `corgi-review`

```json
{
  "slug": "corgi-review",
  "tier": "molecule",
  "depends_on": ["resolve-config", "resolve-worktree", "parse-tasks",
                  "sync-issue-gh", "sync-issue-gl", "generate-rich-summary"],
  "platform": "universal"
}
```

**流程：**

1. `resolve-config` + `resolve-worktree` → 定位 change
2. `parse-tasks` → 找 status == "review" 的 group
3. **Platform dispatch** → `sync-issue-gh/gl`：讀取 tracker 上的 feedback/comments
4. 執行 quality checks（定義在 `references/quality-checks.md`）
5. `generate-rich-summary` → 產生 review report
6. **Platform dispatch** → `sync-issue-gh/gl`：add-comment(review report)
7. **Human gate** → 強制使用者選擇：
   - **Approve** → `sync-issue-gh/gl`：close child issue，更新 parent 進度
   - **Reject** → append fix tasks 到 tasks.md，`sync-issue-gh/gl`：child issue → `in-progress`
   - **Discuss** → 只對話，不改狀態，之後重新問
8. **輸出：**
   - Approve + more groups → 提示 `/corgi-apply`
   - Approve + all done → 提示 `/corgi-archive`
   - Reject → 提示 `/corgi-apply`

**Reference docs 保留在 molecule 內：** `quality-checks.md`、`review-decisions.md`、`repair-flow.md` 是 review-specific 邏輯，不需抽成 atom。

**合併來源：** `corgispec-review` + `corgispec-gh-review`

### Molecule 4: `corgi-archive`

```json
{
  "slug": "corgi-archive",
  "tier": "molecule",
  "depends_on": ["resolve-config", "resolve-worktree", "parse-tasks",
                  "sync-issue-gh", "sync-issue-gl"],
  "platform": "universal"
}
```

**流程：**

1. `resolve-config` + `resolve-worktree` → 定位 change
2. `parse-tasks` → 檢查未完成任務，如有則 warn
3. 評估 delta spec sync 需求
4. **Platform dispatch** → `sync-issue-gh/gl`：close 所有 child + parent issues
5. 移動 change dir 到 `openspec/changes/archive/YYYY-MM-DD-<name>/`
6. 如果 worktree → 清除 worktree，保留 branch
7. **輸出：** Lifecycle complete

**合併來源：** `corgispec-archive-change` + `corgispec-gh-archive`

### Molecule 5: `corgi-explore`

```json
{
  "slug": "corgi-explore",
  "tier": "molecule",
  "depends_on": ["resolve-config", "resolve-worktree", "parse-tasks"],
  "platform": "universal"
}
```

**流程：** 純 read-only。讀取 artifacts + live issue state，不做任何 mutation。不呼叫 sync-issue atoms（只讀取，不寫入）。

**合併來源：** `corgispec-explore` + `corgispec-gh-explore`

### Molecule 6: `corgi-install`

```json
{
  "slug": "corgi-install",
  "tier": "molecule",
  "depends_on": ["resolve-config"],
  "platform": "universal"
}
```

**流程：** 大部分邏輯自包含。只需 `resolve-config` 判斷 schema 類型。驗證 prerequisites → 複製 managed fileset → patch config → 寫 manifest + report。

**來源：** `corgispec-install`（幾乎不需要改動，只是加上 skill.meta.json 和移到 molecules/ 目錄）

---

## Platform Adapter 模式

### 設計決定

**不做統一的 `sync-issue` atom。** 原因：

1. `gh` 和 `glab` CLI 的參數格式差異顯著（label 語法、issue body 模板、API 行為）
2. 兩個 platform atom 各自內聚，更容易測試
3. 新增平台只需新增一個 atom（如 `sync-issue-azdo`），不用碰 molecule

### Molecule 內的 Dispatch 模式

每個需要 issue 操作的 molecule 在 SKILL.md 內用以下模式：

```markdown
## Platform Dispatch

所有 issue 操作根據 `resolve-config` 的 platform 欄位決定：

- 如果 platform == `github` → 呼叫 `sync-issue-gh`
- 如果 platform == `gitlab` → 呼叫 `sync-issue-gl`
- 如果 platform 未知 → 報錯並停止

此判斷在每個需要 issue 操作的步驟中執行。
```

### 新增平台的成本

| 步驟 | 工作量 |
|---|---|
| 新增 `sync-issue-<platform>` atom | 寫一個 SKILL.md + skill.meta.json |
| 更新 6 個 molecules 的 dispatch 邏輯 | 每個加一個 `if platform == <new>` 分支 |
| 新增 schema（如 `azdo-tracked`） | 寫 schema.yaml + templates |
| **總計** | 1 atom + 6 個小改動 + 1 schema |

比現在的成本（複製 6 個完整 skill）低一個數量級。

---

## CLI 工具：`ds-skills`

### 安裝

```bash
npm install -g ds-skills
# 或
npx ds-skills <command>
```

### 命令

| 命令 | 功能 | 退出碼 |
|---|---|---|
| `ds-skills validate [--path <dir>]` | 驗證所有 skills 的結構和約束 | 0=pass, 1=fail |
| `ds-skills graph [--format mermaid\|dot] [--tier <tier>]` | 產生依賴圖 | stdout |
| `ds-skills list [--tier atom\|molecule\|compound] [--platform <p>]` | 列出 skills | stdout |
| `ds-skills install --target <opencode\|claude\|codex> [--path <project>]` | 安裝 skills 到目標環境 | 0=success |
| `ds-skills check-deps <slug>` | 顯示某個 skill 的完整依賴樹 | stdout |

### `ds-skills validate` 規則

1. 每個 skill 目錄有 `SKILL.md` + `skill.meta.json`
2. `skill.meta.json` 符合 JSON Schema
3. 層級約束（atom 無依賴、molecule 只依賴 atom、compound 只依賴 molecule）
4. `depends_on` 的 slugs 全部指向存在的 skills
5. 無循環依賴（拓撲排序驗證）
6. `SKILL.md` frontmatter `name` == `skill.meta.json` `slug`
7. Platform 相容性（github atom 不被 gitlab molecule 依賴）
8. 目錄位置和 `installation.base_path` 一致

### `ds-skills install` 行為

1. 掃描 `.opencode/skills/` 目錄下所有 atoms/molecules/compounds
2. 根據 `--target`，複製到對應的使用者級目錄：
   - `opencode` → `~/.config/opencode/skill/`
   - `claude` → `~/.claude/skills/`
   - `codex` → `~/.codex/skills/`
3. 保留目錄層級（`atoms/resolve-config/` 複製為 `atoms/resolve-config/`）
4. 向後相容：如果偵測到舊格式 skills（無 `skill.meta.json`），warn 但仍然複製

### 向後相容

`install-skills.sh` 保留但改為 wrapper：

```bash
#!/bin/bash
# DEPRECATED: Use 'ds-skills install' instead
echo "⚠️  install-skills.sh is deprecated. Use 'npx ds-skills install --target opencode && npx ds-skills install --target claude' instead."
npx ds-skills install --target opencode
npx ds-skills install --target claude
npx ds-skills install --target codex
```

---

## 遷移路徑

### Command Wrappers（Phase 3 需更新）

現有 6 個 command wrappers 在 `.opencode/commands/`：

| Command File | 目前指向 | Phase 3 指向 |
|---|---|---|
| `corgi-propose.md` | `corgispec-propose` 或 `corgispec-gh-propose`（依 platform） | `corgi-propose`（unified） |
| `corgi-apply.md` | `corgispec-apply-change` 或 `corgispec-gh-apply` | `corgi-apply`（unified） |
| `corgi-review.md` | `corgispec-review` 或 `corgispec-gh-review` | `corgi-review`（unified） |
| `corgi-archive.md` | `corgispec-archive-change` 或 `corgispec-gh-archive` | `corgi-archive`（unified） |
| `corgi-explore.md` | `corgispec-explore` 或 `corgispec-gh-explore` | `corgi-explore`（unified） |
| `corgi-install.md` | `corgispec-install` | `corgi-install`（unified） |

Phase 3 後，command wrappers 簡化為單一 skill 引用（無 platform 分支）。`.claude/commands/corgi/` 同步更新。

### Phase 1：Infrastructure（不動現有 skills）

**交付物：**
- `skill.meta.json` JSON Schema 定義檔
- `ds-skills validate` + `ds-skills graph` + `ds-skills list` CLI 命令
- 為現有 11 個 skills 補上 `skill.meta.json`（全部標為 `tier: molecule`，`depends_on: []`）

**驗證：**
- `ds-skills validate` 通過
- 現有 `/corgi-*` workflow 完全不受影響（零改動）

**價值：** 建立基礎設施，所有後續 skill 開發都有結構保障。

### Phase 2：Extract Atoms（現有 skills 不改動）

**交付物：**
- 7 個 atom 目錄（`SKILL.md` + `skill.meta.json`）放在 `atoms/`
- 更新 `ds-skills validate` 加入層級約束規則

**驗證：**
- `ds-skills validate` 通過（atoms 獨立存在，不破壞現有 molecules）
- `ds-skills graph` 可以產生依賴圖

**價值：** Atoms 可以被其他用途引用。工具鏈完整。

### Phase 3：Rewrite Molecules（breaking change）

**交付物：**
- 6 個新 molecule 目錄（`corgi-propose`、`corgi-apply`、`corgi-review`、`corgi-archive`、`corgi-explore`、`corgi-install`）
- 更新 6 個 `.opencode/commands/corgi-*.md` 和 `.claude/commands/corgi/*.md` 指向新 molecules
- 更新 `ds-skills install` 安裝新結構
- 補全 `.codex/skills/` 缺失的 `corgispec-install`

**驗證（關鍵）：**
- 在 GitHub-tracked 專案上跑完整 propose → apply → review → archive lifecycle
- 在 GitLab-tracked 專案上跑完整 lifecycle
- Worktree isolation mode 測試
- `ds-skills validate` 通過

**回滾計畫：** 如果驗證失敗，command wrappers 切回指向舊 skills（Phase 2 的舊 skills 仍在）。

### Phase 4：Cleanup

**交付物：**
- 刪除舊的 12 個平台特定 skills
- `install-skills.sh` 改為 deprecated wrapper
- 更新 README.md 和 README.zh-TW.md

**驗證：**
- `ds-skills validate` 通過
- `ds-skills install --target opencode` + `ds-skills install --target claude` 成功
- 現有已安裝的使用者環境能 graceful 升級

---

## 數字摘要

| 指標 | Before | After |
|---|---|---|
| SKILL.md 數量（不含鏡像） | 11 | 13（7 atoms + 6 molecules） |
| 平台重複度 | ~90%（6 phases × 2 platforms） | 0%（platform dispatch 在 molecule 內） |
| 正式元資料 | 0 | 13 個 `skill.meta.json` |
| 驗證工具 | 0 | `ds-skills validate`（8 條規則） |
| 新增平台成本 | 複製 6 個完整 skills | 1 atom + 6 小改動 + 1 schema |
| 安裝工具 | `install-skills.sh`（bash） | `ds-skills install`（Node.js CLI） |

---

## 已知開放問題

1. **Atom 的 SKILL.md 格式**：Atoms 是被 molecules 引用的，不是直接被使用者呼叫的。SKILL.md 的寫法應偏向 API 文件風格（輸入/輸出規格）還是現有的步驟指令風格？**建議：** API 文件風格，包含明確的 Input/Output/Error sections，因為 molecule 的 SKILL.md 會引用 atom 的輸出作為下一步的輸入。

2. **Progressive disclosure**：Agent 平台（Claude Code、OpenCode）的 skill 掃描只讀 frontmatter description。atoms/ 目錄下的 skills 是否應該在 description 中標明「this is an atom, not meant to be called directly」？

3. **CLI 的 npm scope**：`ds-skills` 是否需要 npm scope（如 `@ds-internal/skills-cli`）？取決於是否公開發佈。

4. **Reference docs 的歸屬**：部分 reference docs（如 `worktree-discovery.md`）原本在舊 skill 的 references/ 裡。抽取後它們應該跟著 atom（因為邏輯在 atom）還是留在 molecule（因為 molecule 是入口）？本設計建議：**跟著 atom**，因為 reference doc 描述的是 atom 的實作細節。

5. **Compound 層的預留**：`compounds/` 目錄在 Phase 1-4 為空。當 GitLab issue-phase skills 重構時才會用到。屆時 `issue-phase-development`、`reviewing-issue-phase`、`merging-issue-phase` 會成為 compounds。
