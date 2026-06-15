## 2026-06-09 verify-v2.4.1

### Findings

**Bug 1: bootstrap.test.ts missing closing brace**
- Line 555 was missing `  });` that closes the `it("defaults to global scope...")` test block
- Fixed by inserting `  });` at line 555
- Root cause: merge/copy error during bootstrap enhancement code changes

**Bug 2: .opencode vs .claude skill file byte mismatch**
- 3 files had quoting inconsistency after openspec→corgispec rename:
  - `corgispec-apply-change/SKILL.md`
  - `corgispec-gh-apply/SKILL.md`  
  - `corgispec-gh-propose/SKILL.md`
- `.opencode` used `corgispec apply "<name>" --json` (quoted)
- `.claude` used `corgispec apply <name> --json` (unquoted)
- Synced to `.claude` convention (no quotes for placeholders)
- Fixed by copying `.claude` versions to `.opencode`

**Test Results**
- Build: ✅ 102ms, 127KB output
- Tests: 19 files / 189 tests / 0 failures
- CLI: --version → 2.4.1, --help functional
- References: No stale "openspec" references in changed skill files
- Git: v2.4.1 tag exists, version 2.4.1 in package.json
- package.json: valid JSON, version field correct

**Uncommitted changes**
- 3 whitespace-only files (pre-existing): package.json, list.ts, changes.ts
- 4 fix files (new): 3 skill files + bootstrap.test.ts
