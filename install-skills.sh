#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${HOME}/.claude/skills"
OPENCODE_DIR="${HOME}/.config/opencode/skill"
CODEX_DIR="${HOME}/.codex/skills"
DRY_RUN=0
CODEX=0

usage() {
  cat <<'EOF'
Usage: ./install-skills.sh [--dry-run] [--codex] [--help]

Install this repo's user-level skills for Claude Code and OpenCode.

What gets installed:
  - .claude/skills/corgispec-*        -> ~/.claude/skills/
  - .opencode/skills/corgispec-*      -> ~/.config/opencode/skill/

Options:
  --dry-run   Print planned operations without copying files
  --codex     Also create Codex symlinks (~/.codex/skills/ -> ~/.claude/skills/)
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

create_symlink() {
  local src_dir="$1"
  local dest_dir="$2"
  local name
  name="$(basename "$src_dir")"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN symlink: $dest_dir/$name -> $src_dir"
    return 0
  fi

  if [[ -d "$dest_dir/$name" && ! -L "$dest_dir/$name" ]]; then
    log "Removing physical copy: $dest_dir/$name (replacing with symlink)"
    rm -rf "$dest_dir/$name"
  fi

  ln -sfn "$src_dir" "$dest_dir/$name"
  log "Symlinked: $dest_dir/$name -> $src_dir"
}

install_codex_symlinks() {
  log "Codex target: $CODEX_DIR"

  mkdir -p "$CODEX_DIR"

  local matched=0
  for src_dir in "$CLAUDE_DIR"/corgispec-*; do
    if [[ -d "$src_dir" ]]; then
      create_symlink "$src_dir" "$CODEX_DIR"
      matched=1
    fi
  done

  if [[ "$matched" -eq 0 ]]; then
    log "No corgispec-* directories found in $CLAUDE_DIR. Install Claude Code skills first."
  fi
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --codex) CODEX=1 ;;
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

# Install from tiered source (atoms/, molecules/) into flat user-level target
install_glob "$SCRIPT_DIR/.claude/skills/atoms/corgispec-*" "$CLAUDE_DIR"
install_glob "$SCRIPT_DIR/.claude/skills/molecules/corgispec-*" "$CLAUDE_DIR"
install_glob "$SCRIPT_DIR/.opencode/skills/atoms/corgispec-*" "$OPENCODE_DIR"
install_glob "$SCRIPT_DIR/.opencode/skills/molecules/corgispec-*" "$OPENCODE_DIR"

if [[ "$CODEX" -eq 1 ]]; then
  install_codex_symlinks
fi

log "Done. User-level skills are ready for Claude Code and OpenCode."
if [[ "$CODEX" -eq 1 ]]; then
  log "Codex symlinks created under $CODEX_DIR."
fi
