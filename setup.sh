#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_SKILLS="$SCRIPT_DIR/.claude/skills"
CODEX_SKILLS="$SCRIPT_DIR/.codex/skills"
AGENTS_SKILLS="$SCRIPT_DIR/.agents/skills"
CODEX_BACKUP="$SCRIPT_DIR/.codex/skills.backup"
CLAUDE_PLUGIN="$SCRIPT_DIR/.claude-plugin/plugin.json"
CODEX_PLUGIN="$SCRIPT_DIR/.codex-plugin/plugin.json"
DRY_RUN=0
ERRORS=0

OS="$(uname -s 2>/dev/null || echo 'Unknown')"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

usage() {
  cat <<'EOF'
Usage: ./setup.sh [--dry-run] [--help]

One-command symlink initialization for CorgiSpec plugin structure.
Creates per-skill symlinks from .codex/skills/ and .agents/skills/
pointing to the canonical .claude/skills/ directory.

What gets configured:
  .codex/skills/corgispec-*  -> ../../.claude/skills/corgispec-*
  .agents/skills/corgispec-* -> ../../.claude/skills/corgispec-*

Options:
  --dry-run   Preview changes without modifying files
  --help      Show this help text

Features:
  - Idempotent: detects existing correct symlinks, skips re-creation
  - Backup: detects physical copies, prompts before replacing with symlinks
  - Validation: checks plugin.json, counts skills, verifies symlink resolve
  - Windows: gracefully detects missing symlink support, provides fallback instructions
EOF
}

log()  { printf '%b%s%b\n' "$CYAN" "$1" "$NC"; }
ok()   { printf '%b  ✓ %s%b\n' "$GREEN" "$1" "$NC"; }
warn() { printf '%b  ⚠ %s%b\n' "$YELLOW" "$1" "$NC"; }
err()  { printf '%b  ✗ %s%b\n' "$RED" "$1" "$NC"; ERRORS=$((ERRORS + 1)); }

is_symlink() { [[ -L "$1" ]]; }
is_directory() { [[ -d "$1" && ! -L "$1" ]]; }

check_symlink_support() {
  local test_target
  test_target="$(mktemp 2>/dev/null)" || return 1
  local test_link="${test_target}-link"
  if ln -sfn "$test_target" "$test_link" 2>/dev/null; then
    rm -f "$test_target" "$test_link" 2>/dev/null
    return 0
  fi
  rm -f "$test_target" 2>/dev/null
  return 1
}

resolve_target() {
  local skill_name="$1"
  local target_dir="$2"
  local depth
  if [[ "$target_dir" == "$CODEX_SKILLS" ]]; then
    depth="../../"
  else
    depth="../../"
  fi
  echo "${depth}.claude/skills/${skill_name}"
}

needs_symlink() {
  local link_path="$1"
  local expected_target="$2"
  if is_symlink "$link_path"; then
    local current
    current="$(readlink "$link_path")"
    if [[ "$current" == "$expected_target" ]]; then
      return 1
    fi
  fi
  return 0
}

create_symlink() {
  local skill_dir="$1"
  local target_dir="$2"
  local label="$3"
  local skill_name
  skill_name="$(basename "$skill_dir")"
  local link_path="$target_dir/$skill_name"
  local expected_target
  expected_target="$(resolve_target "$skill_name" "$target_dir")"

  mkdir -p "$target_dir"

  if ! needs_symlink "$link_path" "$expected_target"; then
    ok "$label/$skill_name — already configured"
    return 0
  fi

  if is_directory "$link_path"; then
    if [[ "$DRY_RUN" -eq 0 ]]; then
      local confirmed
      printf '%bPhysical directory detected: %s%b\n' "$YELLOW" "$link_path" "$NC"
      printf 'Replace with symlink to %s? [y/N] ' "$expected_target"
      read -r confirmed
      if [[ ! "$confirmed" =~ ^[Yy]$ ]]; then
        warn "$label/$skill_name — skipped (user declined)"
        return 0
      fi
      mkdir -p "$CODEX_BACKUP"
      mv "$link_path" "$CODEX_BACKUP/$skill_name"
      log "  Backed up to $CODEX_BACKUP/$skill_name"
      ln -sfn "$expected_target" "$link_path"
      ok "$label/$skill_name — replaced physical copy with symlink"
    else
      warn "DRY-RUN: would backup $label/$skill_name physical copy, then symlink -> $expected_target"
    fi
  elif [[ -e "$link_path" ]]; then
    if [[ "$DRY_RUN" -eq 0 ]]; then
      rm -rf "$link_path"
      ln -sfn "$expected_target" "$link_path"
      ok "$label/$skill_name — replaced incorrect link"
    else
      warn "DRY-RUN: would replace incorrect link $label/$skill_name -> $expected_target"
    fi
  else
    if [[ "$DRY_RUN" -eq 0 ]]; then
      ln -sfn "$expected_target" "$link_path"
      ok "$label/$skill_name — created symlink -> $expected_target"
    else
      ok "DRY-RUN: would create $label/$skill_name -> $expected_target"
    fi
  fi
}

validate() {
  log "Validating plugin structure..."

  if [[ -f "$CLAUDE_PLUGIN" ]]; then
    if python3 -c "import json; json.load(open('$CLAUDE_PLUGIN'))" 2>/dev/null; then
      ok ".claude-plugin/plugin.json — valid JSON"
    else
      err ".claude-plugin/plugin.json — invalid JSON"
    fi
  else
    err ".claude-plugin/plugin.json — missing"
  fi

  if [[ -f "$CODEX_PLUGIN" ]]; then
    if python3 -c "import json; json.load(open('$CODEX_PLUGIN'))" 2>/dev/null; then
      ok ".codex-plugin/plugin.json — valid JSON"
    else
      err ".codex-plugin/plugin.json — invalid JSON"
    fi
  else
    err ".codex-plugin/plugin.json — missing"
  fi

  local claude_count
  claude_count=$(find "$CLAUDE_SKILLS" -maxdepth 1 -type d -name 'corgispec-*' 2>/dev/null | wc -l)
  log "Skills in .claude/skills/: $claude_count"

  local all_ok=1
  for skill_dir in "$CLAUDE_SKILLS"/corgispec-*; do
    [[ -d "$skill_dir" ]] || continue
    local name
    name="$(basename "$skill_dir")"

    for target in "$CODEX_SKILLS" "$AGENTS_SKILLS"; do
      local link="$target/$name"
      local expected
      expected="$(resolve_target "$name" "$target")"
      if is_symlink "$link"; then
        local current
        current="$(readlink "$link")"
        if [[ "$current" != "$expected" ]]; then
          err "${target#$SCRIPT_DIR/}/$name — points to $current, expected $expected"
          all_ok=0
        fi
      else
        err "${target#$SCRIPT_DIR/}/$name — not a symlink"
        all_ok=0
      fi
    done
  done

  if [[ "$all_ok" -eq 1 ]]; then
    ok "All symlinks resolve correctly"
  fi

  log "Validation: $(if [[ "$ERRORS" -gt 0 ]]; then printf '%b%d error(s)%b' "$RED" "$ERRORS" "$NC"; else printf '%bclean%b' "$GREEN" "$NC"; fi)"

  return "$ERRORS"
}

main() {
  log "CorgiSpec setup — canonical: .claude/skills/"

  if ! check_symlink_support; then
    warn "Symlink creation is not supported in this environment (OS: $OS)."
    echo ""
    echo "  CorgiSpec uses symlinks to share skills from .claude/skills/ to"
    echo "  .codex/skills/ and .agents/skills/ without file duplication."
    echo ""
    if [[ "$OS" == MINGW* || "$OS" == MSYS* || "$OS" == CYGWIN* ]]; then
      echo "  On Windows, enable symlink support:"
      echo "    1. Enable Developer Mode (Settings → Update & Security → For Developers)"
      echo "    2. Or run this script from an Administrator terminal"
      echo ""
      echo "  Workaround (manual copy fallback):"
      echo "    cp -r .claude/skills/corgispec-* .codex/skills/"
      echo "    cp -r .claude/skills/corgispec-* .agents/skills/"
    else
      echo "  This is unexpected on your platform ($OS). Please check:"
      echo "    - Filesystem supports symlinks (not FAT32/exFAT)"
      echo "    - You have write permission to this directory"
    fi
    echo ""
    log "Exiting gracefully — no changes were made."
    exit 0
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN mode — no filesystem changes will be made"
  fi

  local -a skills=()
  shopt -s nullglob
  for d in "$CLAUDE_SKILLS"/corgispec-*; do
    skills+=("$d")
  done
  shopt -u nullglob

  log "Found ${#skills[@]} skill(s) in .claude/skills/"

  for skill in "${skills[@]}"; do
    create_symlink "$skill" "$CODEX_SKILLS" ".codex/skills"
    create_symlink "$skill" "$AGENTS_SKILLS" ".agents/skills"
  done

  echo ""
  validate
}

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf '%bUnknown argument: %s%b\n\n' "$RED" "$arg" "$NC" >&2
      usage >&2
      exit 1
      ;;
  esac
done

main
