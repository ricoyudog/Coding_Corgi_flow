---
type: wiki
updated: 2026-05-05
tags:
  - plugin
  - codex
  - claude-code
  - agent-skills
  - distribution
  - marketplace
source:
  - https://docs.claude.com/en/docs/claude-code/plugins
  - https://developers.openai.com/codex/plugins/build
  - https://developers.openai.com/codex/plugins
  - https://deepwiki.com/openai/codex/5.11-plugins-system
  - https://agentskills.io
  - https://deepwiki.com/anthropics/claude-plugins-official
---

# Codex Plugin + Claude Code Plugin 分發研究

> 研究如何將 OpenSpec GitFlow (CorgiSpec) 專案的 17 個 Agent Skills 包裝成 Plugin，透過兩個平台的 Marketplace 分發給團隊。

---

## 一、兩大平台 Plugin 系統總覽

| 面向 | **Claude Code (Anthropic)** | **Codex (OpenAI)** |
|------|---------------------------|-------------------|
| Plugin 清單 | `.claude-plugin/plugin.json` | `.codex-plugin/plugin.json` |
| Skill 路徑 | `.claude/skills/` | `.agents/skills/` |
| 元件類型 | Skills, Commands, Agents, Hooks, MCP | Skills, Apps, MCP Servers |
| Marketplace | GitHub Repo（`marketplace.json`） | Repo-scoped / Personal（公開市場尚未開放第三方） |
| 快速建立工具 | `/plugin-dev:create-plugin` | `@plugin-creator` |
| 團隊自動安裝 | `.claude/settings.json` + `enabledPlugins` | `.agents/marketplace.json` + policy |
| 共用標準 | Agent Skills 開放標準 (agentskills.io) | Agent Skills 開放標準 (同左) |
| 發布日期 | 2025/10（v2.0.12+） | 2026/03（v0.117.0+） |
| CLI 載入 | `claude --plugin-dir ./path` | repo-scoped 自動讀取 `.agents/` |

---

## 二、Plugin 目錄結構對比

### Claude Code Plugin

```
plugin-name/
├── .claude-plugin/
│   └── plugin.json          # 必選：Plugin 清單
├── README.md
├── .claude/
│   └── skills/              # Agent Skills（由 Claude Code 自動發現，不需寫入 manifest）
│       └── skill-name/
│           ├── SKILL.md      # YAML 前綴 + Markdown 指令
│           ├── references/   # 按需加載的詳細文檔
│           ├── scripts/      # 可執行腳本
│           └── assets/       # 模板/圖標
├── commands/                 # Slash Commands（/xxx.md）
├── agents/                   # 子代理定義
├── hooks/                    # 事件鉤子（hooks.json + scripts/*.sh）
└── .mcp.json                 # MCP 伺服器配置
```

### Codex Plugin

```
plugin-name/
├── .codex-plugin/
│   └── plugin.json          # 必選：Plugin 清單
├── skills/                   # 或指定路徑（plugin.json 中設定 skills 欄位）
│   └── skill-name/
│       └── SKILL.md          # 同 Agent Skills 標準
├── hooks/                    # 生命週期鉤子
├── scripts/                  # 輔助腳本
├── assets/                   # 圖標/截圖
├── .mcp.json                 # MCP 配置
└── .app.json                 # 第三方應用整合
```

### 關鍵差異

- Claude Code 的 skills/agents/commands **自動發現**（不需寫入 plugin.json）
- Codex 需要在 `plugin.json` 中**顯式指定** `"skills": "./skills/"`
- Claude Code 支援 **Agents（子代理）**和 **Hooks（事件鉤子）**，Codex 目前不支援（預計後續加入 sub-agents）

---

## 三、核心檔案規格

### 3.1 plugin.json — Claude Code

```json
{
  "name": "corgispec",
  "version": "2.0.0",
  "description": "OpenSpec GitFlow — AI-driven change management: propose → apply → review → archive",
  "author": {
    "name": "呆呆王",
    "url": "https://github.com/your-org/openspec_gitflow_modified"
  },
  "license": "MIT",
  "keywords": ["openspec", "gitflow", "change-management", "spec-driven"],
  "repositories": [
    { "type": "git", "url": "https://github.com/your-org/openspec_gitflow_modified" }
  ]
}
```

⚠️ **嚴格規則：**
- `author` 必須是物件 `{"name": "..."}`，不能是字串
- `version` 必須是字串 `"1.0.0"`，不能是數字
- `keywords` 必須是陣列，不能是字串
- 不要手寫 `agents`、`skills`、`slashCommands` — Claude Code 自動發現

### 3.2 plugin.json — Codex（完整 Schema）

來源：[developers.openai.com/codex/plugins/build](https://developers.openai.com/codex/plugins/build)

Codex 的 `plugin.json` 比 Claude Code **欄位更多**，尤其是 `interface` 區塊提供完整的安裝介面呈現資訊。

#### 必要欄位

```json
{
  "name": "corgispec",
  "version": "2.0.0",
  "description": "OpenSpec GitFlow — AI-driven change management",
  "skills": "./skills/"
}
```

#### 完整欄位一覽

| 欄位 | 類型 | 說明 |
|------|------|------|
| `name` | string | Plugin 識別碼（kebab-case，須與目錄名一致） |
| `version` | string | 語意化版本（`"2.0.0"`） |
| `description` | string | 簡短描述 |
| `author` | object | `{name, email, url}` |
| `homepage` | string | 專案首頁 URL |
| `repository` | string | Git 倉庫 URL |
| `license` | string | 授權類型（`"MIT"`） |
| `keywords` | string[] | 搜尋標籤 |
| `skills` | string | Skills 目錄路徑（`"./skills/"`） |
| `mcpServers` | string | MCP 配置路徑（`"./.mcp.json"`） |
| `apps` | string | App 連接器路徑（`"./.app.json"`） |
| `hooks` | string | 生命週期鉤子（`"./hooks/hooks.json"`） |
| `interface` | object | 安裝介面呈現資訊（見下方） |

#### interface 物件欄位

| 欄位 | 類型 | 說明 |
|------|------|------|
| `displayName` | string | Codex UI 中顯示的 Plugin 名稱 |
| `shortDescription` | string | 簡短描述 |
| `longDescription` | string | 詳細描述 |
| `developerName` | string | 開發者署名 |
| `category` | string | 分類（`"Productivity"`） |
| `capabilities` | string[] | 能力標籤（`["Read", "Write"]`） |
| `websiteURL` | string | 官方網站 |
| `privacyPolicyURL` | string | 隱私政策連結 |
| `termsOfServiceURL` | string | 服務條款連結 |
| `defaultPrompt` | string[] | 建議提示詞 |
| `brandColor` | string | 品牌色（`"#10A37F"`） |
| `composerIcon` | string | 圖標路徑（`"./assets/icon.png"`） |
| `logo` | string | Logo 路徑 |
| `screenshots` | string[] | 截圖路徑陣列 |

#### 完整範例

```json
{
  "name": "corgispec",
  "version": "2.0.0",
  "description": "OpenSpec GitFlow — AI-driven change management: propose → apply → review → archive",
  "author": {
    "name": "呆呆王",
    "url": "https://github.com/your-org/openspec_gitflow_modified"
  },
  "repository": "https://github.com/your-org/openspec_gitflow_modified",
  "license": "MIT",
  "keywords": ["openspec", "gitflow", "change-management", "spec-driven"],
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "CorgiSpec",
    "shortDescription": "AI-driven change management workflow",
    "longDescription": "OpenSpec GitFlow 提供完整的 AI 驅動變更管理：propose → apply → review → archive，支援 GitLab/GitHub 整合、memory 持久化、worktree 隔離。",
    "developerName": "呆呆王",
    "category": "Workflow",
    "capabilities": ["Read", "Write", "Execute"],
    "brandColor": "#10A37F"
  }
}
```

### 3.3 SKILL.md — 兩平台共用格式

```markdown
---
name: skill-name
description: 功能描述 + 觸發時機（Use when...）
license: MIT
compatibility: Requires openspec CLI
metadata:
  author: openspec
  version: "2.0"
---

# 指令內容（Markdown Body）
```

兩平台都遵循 **Agent Skills 開放標準**（agentskills.io），SKILL.md 完全互通。關鍵欄位：
- `name`：1-64 字元，小寫字母+數字+連字號，必須與目錄名一致
- `description`：1-1024 字元，AI 用這段文字判斷是否觸發 Skill
- 其他欄位（`license`, `compatibility`, `metadata`）可選

### 3.4 漸進式加載（Progressive Disclosure）— Agent Skills 核心設計

| 層級 | 內容 | 何時加載 | token 成本 |
|------|------|----------|-----------|
| 第一層 | YAML 元數據（name + description） | 始終常駐 | ~30-50 tokens/skill |
| 第二層 | SKILL.md 的 Markdown Body | Skill 觸發時 | 按需 |
| 第三層 | references/、scripts/、assets/ | 調用時才讀取 | 用完釋放 |

這意味著即使有 100+ 個 Skills，也不會拖慢 AI 效能。

---

## 四、團隊分發機制

### 4.1 Claude Code — 三種分發層級

| 層級 | 方法 | 適用場景 |
|------|------|---------|
| **專案內建** | 直接放在專案的 `.claude/skills/` | clone 即用，零配置 |
| **GitHub Marketplace** | `/plugin marketplace add owner/repo` | 跨專案、跨團隊 |
| **企業管理** | `strictKnownMarketplaces` + managed settings | 大規模部署（500+ 人） |

#### 專案內建（現有模式）— 最簡單

團隊成員 clone 專案後，Skills 自動生效，不需任何設定。這是目前 CorgiSpec 的使用方式。

#### GitHub Marketplace — 跨專案共享

**建立 marketplace repo：**
```
corgispec-marketplace/
├── .claude-plugin/
│   └── marketplace.json
└── plugins/
    └── corgispec/
        ├── .claude-plugin/plugin.json
        └── .claude/skills/...       ← 從主專案複製
```

**marketplace.json：**
```json
{
  "name": "corgispec-marketplace",
  "owner": { "name": "呆呆王" },
  "plugins": [
    {
      "name": "corgispec",
      "source": {
        "source": "github",
        "repo": "your-org/openspec_gitflow_modified",
        "ref": "v2.0.0"              // 鎖定版本！用 tag 或 sha，不用 branch
      },
      "category": "workflow"
    }
  ]
}
```

**團隊安裝指令：**
```bash
/plugin marketplace add your-org/corgispec-marketplace
/plugin install corgispec@corgispec-marketplace
```

#### 團隊自動安裝 — `.claude/settings.json`

```json
{
  "extraKnownMarketplaces": {
    "corgispec": {
      "source": {
        "source": "github",
        "repo": "your-org/corgispec-marketplace"
      }
    }
  },
  "enabledPlugins": {
    "corgispec@corgispec": true
  }
}
```

#### 企業鎖定 — `strictKnownMarketplaces`

```json
{
  "strictKnownMarketplaces": [
    { "source": "github", "repo": "your-org/approved-plugins" }
  ]
}
```

這會**禁止**員工添加任何未經審批的外部 marketplace。

### 4.2 Codex — 三種分發方式（含遠端 Git 支援）

| 方式 | 範圍 | 狀態 |
|------|------|------|
| **Repo-scoped Marketplace**（`.agents/plugins/marketplace.json`） | 綁定特定 repo | ✅ 現在可用 |
| **Personal Marketplace**（`~/.agents/plugins/marketplace.json`） | 個人環境 | ✅ 現在可用 |
| **公開 Plugin Directory** | 所有 Codex 用戶 | ⚠️ 尚未開放第三方提交 |

#### Marketplace 讀取順序（Codex 按此優先級讀取）

1. 公開 Plugin Directory（官方策展）
2. **Repo-scoped**: `$REPO_ROOT/.agents/plugins/marketplace.json`
3. **Claude 相容**: `$REPO_ROOT/.claude-plugin/marketplace.json`（Codex 也能讀！）
4. **Personal**: `~/.agents/plugins/marketplace.json`

> 💡 **跨平台相容發現**：Codex 會讀取 `.claude-plugin/marketplace.json`（Claude 格式）。這意味著一個 marketplace.json 可以同時服務兩個平台！

#### Marketplace Source 三種類型

| Source Type | 說明 | 範例 |
|-------------|------|------|
| `local` | 本機路徑（相對 marketplace 根目錄，`./` 前綴） | `{"source": "local", "path": "./plugins/my-plugin"}` |
| `git-subdir` | Git 倉庫中的子目錄（支援 `ref` 鎖定版本） | `{"source": "git-subdir", "url": "https://github.com/...", "path": ".", "ref": "v2.0.0"}` |
| `url` | 遠端直接下載 URL | 直接指定 plugin 下載位址 |

#### Repo-Scoped Marketplace（本機）

專案根目錄的 `.agents/plugins/marketplace.json`：
```json
{
  "name": "corgispec-repo-marketplace",
  "interface": {
    "displayName": "CorgiSpec - OpenSpec GitFlow"
  },
  "plugins": [
    {
      "name": "corgispec",
      "source": {
        "source": "local",
        "path": "."
      },
      "policy": {
        "installation": "INSTALLED_BY_DEFAULT",
        "authentication": "ON_INSTALL"
      },
      "category": "Workflow"
    }
  ]
}
```

#### Git 遠端分發（跨專案共用）

```json
{
  "plugins": [
    {
      "name": "corgispec",
      "source": {
        "source": "git-subdir",
        "url": "https://github.com/your-org/openspec_gitflow_modified.git",
        "path": ".",
        "ref": "v2.0.0"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Workflow"
    }
  ]
}
```

#### Codex CLI 指令

```bash
# 添加 marketplace（支援 owner/repo GitHub 格式）
codex plugin marketplace add your-org/corgispec-marketplace

# 升級 marketplace
codex plugin marketplace upgrade your-org/corgispec-marketplace

# 移除 marketplace
codex plugin marketplace remove your-org/corgispec-marketplace

# 安裝 Plugin
codex plugin install corgispec@your-org/corgispec-marketplace
```

#### Plugin 快取路徑

Codex 安裝 Plugin 後快取到：
```
~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/
```

Policy 選項：
- `installation`: `AVAILABLE` / `INSTALLED_BY_DEFAULT` / `NOT_AVAILABLE`
- `authentication`: `ON_INSTALL` / `ON_USE`

> ⚠️ **Codex 關鍵限制**：截至 2026/03（v0.117.0），公開 Plugin Directory **尚未開放第三方提交**。但團隊分發已可透過 repo-scoped/personal marketplace 完整運作，且支援 `git-subdir` 遠端來源。

---

## 五、跨平台 Skill 共享策略

### 5.1 核心發現：Symlink 方向陷阱（⚠️ 重要）

來源：Qiita 文章 `t-tonton` (2026) 實測驗證

| 平台 | Symlink 支援 | 快取行為 | 結論 |
|------|-------------|---------|------|
| **Claude Code** | ⚠️ 部分支援 | `/plugin install` 快取時**不跟隨 symlink** | 本體必須在 Claude 側 |
| **Codex** | ✅ 明確支援 | 直接讀取 symlink 目標 | 可以用 symlink 指向外部 |

**致命場景**：如果 Skill 本體放在 Codex 側，Claude Code 透過 symlink 讀取，當用戶執行 `/plugin install` 時，Claude Code 會把 symlink 快取到 `~/.claude/plugins/cache/`，但**不複製 symlink 指向的實際內容** → 快取副本是空的 → **Silent Failure**。

**正確策略**：
- Skill **本體**放在 `.claude/skills/`（Claude Code 能直接讀取）
- Codex 用 **symlink** 指向 Claude Code 側（Codex 支援 symlink）
- 方向：`.agents/skills/skill-name → ../../.claude/skills/skill-name`

### 5.2 三種同步策略對比

| 策略 | 優點 | 缺點 | 適合 |
|------|------|------|------|
| **Symlink（推薦）** | 零維護、即時同步、單一事實來源 | Windows 需要 `mklink /D`，需管理者權限 | Skills 頻繁迭代 |
| **sync-skills 工具** | 自動化解衝突、支援 13+ 平台、處理平台特有欄位 | 多一層依賴 | 跨倉庫分發、大團隊 |
| **手動複製 / install-skills.sh** | 最簡單、目前就在用 | 容易不同步 | Skills 穩定後 |

### 5.3 本專案推薦架構

```
openspec_gitflow_modified/
├── .claude/
│   └── skills/                        # ← Canonical Source（Git 追蹤）
│       ├── corgispec-propose/
│       ├── corgispec-apply-change/
│       └── ...（17 個 skills）
├── .codex/
│   └── skills/                        # ← Symlink → .claude/skills/
│       ├── corgispec-propose → ../../.claude/skills/corgispec-propose/
│       └── ...
├── .opencode/
│   └── skills/                        # ← 目前是實體複製（install-skills.sh）
│       └── ...
├── .claude-plugin/
│   └── plugin.json                    # Claude Code Plugin 清單
├── .codex-plugin/
│   └── plugin.json                    # Codex Plugin 清單
├── .agents/
│   ├── skills/                        # ← Symlink → .claude/skills/（Codex 讀取路徑）
│   └── plugins/
│       └── marketplace.json           # Codex repo-scoped marketplace
├── .claude-plugin/
│   └── marketplace.json               # ← Codex 也能讀！跨平台共用 marketplace
├── .claude/
│   └── settings.json                  # 團隊自動安裝配置
├── install-skills.sh                  # 現有的安裝腳本（可擴充支援 Codex symlink）
└── setup.sh                           # 新建：一鍵初始化 symlink + marketplace
```

---

## 六、現有專案狀態

### 6.1 已就緒

- `.claude/skills/` — 17 個 Skills，符合 Agent Skills 標準 ✅
- `.codex/skills/` — 17 個 Skills（實體複製） ✅
- `.opencode/skills/` — 17 個 Skills（實體複製） ✅
- `install-skills.sh` — Claude Code + OpenCode 安裝腳本 ✅
- `skill.meta.json` — 每個 Skill 已宣告 `installation.targets: ["opencode", "claude", "codex"]` ✅
- `wiki/research/` — 研究筆記存放目錄 ✅

### 6.2 待建立

| 檔案 | 用途 | 優先級 |
|------|------|--------|
| `.claude-plugin/plugin.json` | Claude Code Plugin 清單 | 🔴 高 |
| `.codex-plugin/plugin.json` | Codex Plugin 清單 | 🔴 高 |
| `.agents/skills/` symlink | Codex 讀取路徑（symlink → `.claude/skills/`） | 🔴 高 |
| `.agents/plugins/marketplace.json` | Codex repo-scoped marketplace | 🟡 中 |
| `.claude/settings.json` | 團隊自動安裝 | 🟡 中 |
| `setup.sh` | 一鍵初始化腳本 | 🟡 中 |
| 獨立 Marketplace Repo | 跨專案分發 | 🟢 低 |

### 6.3 建議優化

- **將 `.codex/skills/` 從實體複製改為 symlink**：消除同步負擔，確保單一事實來源
- **將 `.opencode/skills/` 也改為 symlink**（可選，OpenCode 也支援 symlink）
- **擴充 `install-skills.sh`**：加入 Codex symlink 邏輯和 `setup.sh` 功能
- **補 `CLAUDE.md`**：提供專案級 Agent 上下文（AGENTS.md 已存在於根目錄）

---

## 七、執行計畫

### Phase 1：Plugin 包裝（1 小時內）

1. 建立 `.claude-plugin/plugin.json`
2. 建立 `.codex-plugin/plugin.json`
3. 建立 `.agents/skills/` symlink（指向 `.claude/skills/`）
4. 寫 `setup.sh` 一鍵初始化腳本

### Phase 2：團隊分發（1 小時內）

5. 建立 `.claude/settings.json`（團隊自動安裝）
6. 建立 `.agents/plugins/marketplace.json`（Codex repo-scoped）
7. 更新 `install-skills.sh`，加入 Codex symlink 支援

### Phase 3：跨專案分發（選用）

8. 建立獨立 `corgispec-marketplace` Git repo
9. 設定 version pinning（用 git tag + sha）
10. 撰寫團隊 onboarding 文件

---

## 八、關鍵發現與陷阱

### 陷阱 1：Claude Code Symlink 快取黑洞

Claude Code 的 `/plugin install` 不跟隨 symlink。Skill 本體必須在 `.claude/skills/` 內，不能透過 symlink 指向外部。Codex 則無此問題。

### 陷阱 2：Codex 公開市場未開放（但 git-subdir 可替代）

截至 2026/03（v0.117.0），Codex 公開 Plugin Directory 尚未開放第三方提交。但團隊分發可透過 `git-subdir` source 類型從 GitHub 遠端安裝，效果接近 Claude Code 的 GitHub marketplace。且 Codex 能讀取 `.claude-plugin/marketplace.json`（Claude 格式），兩個平台可共用同一個 marketplace 檔案。

### 陷阱 3：plugin.json 格式嚴格

Claude Code 的 `plugin.json` 對格式極嚴格：`author` 必須是物件、`version` 必須是字串、`keywords` 必須是陣列。格式錯誤會導致 plugin 無法載入，且錯誤訊息不明顯。

### 陷阱 4：Windows Symlink

Windows 的 `mklink /D` 需要管理者權限。團隊中有 Windows 開發者時，需要提供 `.bat` 替代腳本或使用 Developer Mode 啟用非管理者 symlink。

### 陷阱 5：多平台 Skill 欄位相容性

Agent Skills 標準只強制 `name` + `description`。其他 YAML 欄位（`license`, `compatibility`, `metadata`, `allowed-tools`, `disable-model-invocation` 等）在不同平台可能有不同行為。最佳實踐：只在前綴放通用欄位，平台特有設定放在各自的設定檔（`.claude/settings.json` / `agents/openai.yaml`）。

---

## 九、參考資源

### 官方文檔
- [Claude Code Plugin Docs](https://docs.claude.com/en/docs/claude-code/plugins)
- [Codex Plugin Docs — Overview](https://developers.openai.com/codex/plugins)
- [Codex Plugin Docs — Build](https://developers.openai.com/codex/plugins/build)
- [Codex Plugins System — DeepWiki 技術深入](https://deepwiki.com/openai/codex/5.11-plugins-system)
- [Agent Skills 開放標準](https://agentskills.io)
- [Anthropic Skills Repo](https://github.com/anthropics/skills)

### 社群資源
- [plugin-dev Toolkit — DeepWiki](https://deepwiki.com/anthropics/claude-plugins-official/7.1.1-plugin-dev-toolkit)
- [Codex 自定义插件开发实战 — poloapi.com](https://poloapi.com/poloapi-blog/Practical-experience-in-developing-custom-plugins-for-Codex)
- [Codex 的 Skill 與 Plugin 有何差別 — jakeuj.com](https://jakeuj.com/codex-skill-vs-plugin.html)
- [Claude Code 凱神實戰指南 — Skills 定制](https://ai.codefather.cn/post/2036645197554688001)
- [Claude Code 凱神實戰指南 — Plugins 全攻略](https://www.codefather.cn/post/2038514416433012738)
- [A Claude Code Plugin in an Afternoon — heise.de](https://www.heise.de/en/blog/A-Claude-code-plugin-in-an-afternoon-What-I-learned-11254988.html)
- [How to Build Claude Code Plugins — DataCamp](https://www.datacamp.com/pl/tutorial/how-to-build-claude-code-plugins)

### 跨平台工具
- [sync-skills — GitHub](https://github.com/viteinfinite/sync-skills)
- [califio/skills — Codex + Claude Code 雙平台 skills](https://github.com/califio/skills)
- [Symlink 陷阱實測 — Qiita (日文)](https://qiita.com/t-tonton/items/7dbee3180f34a72e12b6)
- [Codex vs Claude Code Skills 對比 — Kanaries](https://docs.kanaries.net/articles/codex-vs-claude-code-skills)

### 企業治理
- [Your Claude Plugin Marketplace Needs More Than a Git Repo](https://dev.to/michaeltuszynski/your-claude-plugin-marketplace-needs-more-than-a-git-repo-5631)
- [Team Setup Guide: Standardizing Claude Code Plugin Usage — Skywork](https://skywork.ai/blog/claude-code-plugin-standardization-team-guide/)
- [OpenAI Adds Plugin System to Codex — InfoWorld](https://www.infoworld.com/article/4151214/openai-adds-plugin-system-to-codex-to-help-enterprises-govern-ai-coding-agents.html)
