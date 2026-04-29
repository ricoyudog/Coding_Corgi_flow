#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${HOME}/.claude/skills"
OPENCODE_DIR="${HOME}/.config/opencode/skill"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: ./install-skills.sh [--dry-run] [--help]

Install this repo's user-level skills for Claude Code and OpenCode.

What gets installed:
  - .claude/skills/openspec-*        -> ~/.claude/skills/
  - .opencode/skills/openspec-*      -> ~/.config/opencode/skill/

Options:
  --dry-run   Print planned operations without copying files
  --help      Show this help text
EOF
}

log() {
  printf '%s\n' "$1"
}

copy_dir() {
  local src="$1"
  local dest_root="$2"
  local name
  name="$(basename "$src")"

  mkdir -p "$dest_root"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN install: $src -> $dest_root/$name"
    return 0
  fi

  rm -rf "$dest_root/$name"
  cp -a "$src" "$dest_root/"
  log "Installed: $src -> $dest_root/$name"
}

install_glob() {
  local pattern="$1"
  local dest_root="$2"
  local matched=0
  local path
  local -a paths=()

  shopt -s nullglob
  paths=( $pattern )
  for path in "${paths[@]}"; do
    if [[ -d "$path" ]]; then
      copy_dir "$path" "$dest_root"
      matched=1
    fi
  done
  shopt -u nullglob

  if [[ "$matched" -eq 0 ]]; then
    log "No matching directories for pattern: $pattern"
  fi
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n\n' "$arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

log "Repo root: $SCRIPT_DIR"
log "Claude target: $CLAUDE_DIR"
log "OpenCode target: $OPENCODE_DIR"

install_glob "$SCRIPT_DIR/.claude/skills/openspec-*" "$CLAUDE_DIR"
install_glob "$SCRIPT_DIR/.opencode/skills/openspec-*" "$OPENCODE_DIR"

log "Done. User-level skills are ready for Claude Code and OpenCode."
