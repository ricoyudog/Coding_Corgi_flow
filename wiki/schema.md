---
type: wiki
updated: 2026-05-12
status: accepted
source: "[[decisions/wiki-maintenance-contract|Wiki Maintenance Contract]]"
---

# Wiki Schema — Page Types, Frontmatter & Update Contract

## A. Page Types & Frontmatter

| type | 必需欄位 | 可選欄位 |
|------|---------|---------|
| pattern | `type: wiki`, `created`, `source_change` | `tags` |
| decision | `type: wiki`, `updated`, `status` (proposed/accepted/superseded) | `source`, `tags` |
| session | `type: wiki`, `created`, `source_change`, `status` | `tags` |
| research | `type: wiki`, `updated`, `source` | `tags` |
| meta | `type: wiki`, `generated` | `tags` |

> `wiki/architecture/` is planned but not yet active — no `_index.md` needed until content exists.

## B. Update Contract

| 觸發操作 | 必須同步的動作 |
|----------|---------------|
| 在 wiki 子目錄下新增或刪除任一 .md | 更新對應的 `_index.md` |
| 完成 `corgispec-archive` | 追加 `wiki/log.md` 一條記錄 |
| 完成 `corgispec-archive` | 檢查是否有可抽取的 decision → 若有則創建 decision page |
| 完成 `corgispec-memory-extract` | 更新對應 `_index.md` |
| 完成一次 session | 同時更新 `memory/session-bridge.md` 和 `wiki/hot.md` |
| 跑 `/corgi-lint` | 檢查 orphan page、frontmatter 合規、_index 同步、log 覆蓋率 |

## C. Exemptions

- **Root-level files** (`hot.md`, `index.md`, `schema.md`, `log.md`) 不受 `_index.md` 覆蓋要求約束
- 頁面可透過 `unlisted: true` frontmatter 欄位從 `_index.md` 中排除

## D. Log Format

`wiki/log.md` 採 append-only，每行一事件：

```
YYYY-MM-DD | action change-name | +added-file -removed-file
```
