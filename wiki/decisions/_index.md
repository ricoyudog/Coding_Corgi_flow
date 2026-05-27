---
type: wiki
updated: 2026-05-26
---

# Decisions Index

> Key decisions made during reviews and implementation.

## 2026-05-26

- [[2026-05-26/openspec-to-corgi-rebrand|OpenSpec → Corgi Branding 全面替换]] — 2026-05-26 — proposed
  - 将所有用户可见的 "OpenSpec" 品牌文本替换为 "Corgi"，与 `/corgi-*` 命令命名一致
- [[2026-05-26/hooks-augment-not-replace-skills|Hooks Augment Skills, Not Replace Them]] — 2026-05-26 — accepted
  - Hook 是 Skill 的补位增强，不是替代。Skill 文件保留所有步骤作为 fallback

## Earlier

- [[corgispec-review-verify-upgrade|Upgrade corgispec Review & Verify Pipeline]] — 2026-05-04 — proposed
  - 借鏡 addyosmani/agent-skills，分三階段升級品質保證流程
- [[wiki-maintenance-contract|Wiki Maintenance Contract — 修復五缺口並建立長期一致性機制]] — 2026-05-12 — proposed
  - 研究發現五個 gap 共因於缺少維護契約，定義三階段修復路徑
- [[tier-based-directory-restructure|Tier-Based Directory Restructure]] — 2026-05-12 — accepted
  - 技能目錄從扁平結構重組為分層結構（atoms/molecules），搭配向後相容的兩階段探索
- [[bootstrap-install-consolidation|Bootstrap-Install Consolidation]] — 2026-05-12 — accepted
  - 安裝入口統一為 corgispec bootstrap + 可抓取的 INSTALL.md
