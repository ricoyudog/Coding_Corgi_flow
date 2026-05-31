---
name: corgispec-qa-cli
description: CLI walkthrough — terminal-based verification of commands, flags, exit codes, pipes, and help output.
license: MIT
compatibility: Requires a terminal environment with Bash tool access.
metadata:
  author: corgispec
  version: "1.0"
  generatedBy: "1.0.0"
---

Terminal-based verification of CLI commands, subcommands, flags, exit codes, and help output.

## Overview

This skill guides systematic QA walkthrough of a CLI tool. It covers:
- Command and subcommand execution (happy path and error paths)
- Flag combinations (required, optional, conflicting)
- stdout/stderr recording and validation
- `--help` completeness checks
- Exit code verification
- Environment variable overrides
- Pipe and redirect behavior

Use this skill to verify that a CLI tool behaves correctly before release or after changes.

## When to Use

- After implementing or modifying CLI commands
- Before releasing a CLI tool version
- When verifying that documented behavior matches actual behavior
- When a `qa-testcases.md` file exists and needs execution

Do not use this skill for API testing, UI testing, or non-terminal verification.

## Preconditions

- [ ] The CLI tool is installed or runnable in the current environment
- [ ] Terminal/Bash access is available
- [ ] (Optional) A `qa-testcases.md` file exists with test scenarios

## Steps

### 1. Discover commands and subcommands

Run the CLI's top-level help to enumerate all available commands:

```bash
<cli> --help
```

For each subcommand discovered, also run:

```bash
<cli> <subcommand> --help
```

Record:
- All commands and subcommands listed
- Synopsis/usage line for each
- Whether help output is complete (descriptions, flag docs, examples)

### 2. Verify --help completeness

For each command and subcommand, check that `--help` output includes:

| Element | Present? |
|---------|----------|
| Usage/synopsis line | |
| Description | |
| All flags documented | |
| Required vs optional clearly marked | |
| Default values shown | |
| Examples section | |
| Exit codes documented | |

Report any missing elements.

### 3. Read qa-testcases.md (if present)

If a `qa-testcases.md` file exists in the project (check `docs/`, `tests/`, or project root), read it to obtain structured test scenarios. Each scenario typically includes:

- **ID**: Unique test case identifier
- **Command**: The exact command to run
- **Input**: Any stdin, files, or env vars required
- **Expected stdout**: Pattern or exact match
- **Expected stderr**: Pattern or exact match
- **Expected exit code**: Numeric value
- **Tags**: Categories (e.g., happy-path, error, edge-case)

Use these scenarios as the primary test plan. Execute them in order and record pass/fail for each.

### 4. Execute normal (happy path) scenarios

For each command, run it with valid inputs and verify:

1. **Exit code is 0** (or documented success code):
   ```bash
   <cli> <command> <valid-args>
   echo "Exit code: $?"
   ```

2. **stdout contains expected output** — capture and validate:
   ```bash
   <cli> <command> <valid-args> 2>/dev/null
   ```

3. **stderr is empty or contains only expected warnings**:
   ```bash
   <cli> <command> <valid-args> >/dev/null
   ```

4. **Side effects occur** — files created, state changed, etc.

### 5. Execute error scenarios

For each command, trigger known error conditions:

1. **Missing required flags**:
   ```bash
   <cli> <command>  # omit required flags
   echo "Exit code: $?"
   ```
   Expect: non-zero exit code, helpful error on stderr.

2. **Invalid flag values**:
   ```bash
   <cli> <command> --flag=invalid-value
   echo "Exit code: $?"
   ```

3. **Conflicting flags** (if any documented):
   ```bash
   <cli> <command> --flag-a --flag-b  # mutually exclusive
   echo "Exit code: $?"
   ```

4. **Unknown commands/flags**:
   ```bash
   <cli> nonexistent-command
   echo "Exit code: $?"
   ```

5. **Missing dependencies or prerequisites**:
   Simulate missing files, unreachable services, etc.

Verify each error scenario produces:
- A non-zero exit code (document which code)
- A human-readable error message on stderr
- No partial/corrupt output on stdout

### 6. Verify flag combinations

Test flags in combination:

| Combination | Type | Expected |
|-------------|------|----------|
| All required flags only | Minimal valid | Success |
| Required + each optional flag | Additive | Success with modified behavior |
| Short flags (-v) vs long flags (--verbose) | Equivalence | Same behavior |
| Repeated flags (--flag --flag) | Duplication | Last wins or error |
| Conflicting flags | Mutual exclusion | Clear error message |
| Flag with = vs space separator | Syntax | Both accepted |

### 7. Verify exit codes

Document and verify all exit codes the CLI uses:

| Exit Code | Meaning | Verified? |
|-----------|---------|-----------|
| 0 | Success | |
| 1 | General error | |
| 2 | Usage/argument error | |
| (others) | (tool-specific) | |

Run scenarios that trigger each code and confirm with `echo $?`.

### 8. Verify environment variable overrides

If the CLI respects environment variables:

```bash
# Test env var takes effect
ENV_VAR=value <cli> <command>

# Test env var vs flag precedence (flag should win)
ENV_VAR=env-value <cli> <command> --flag=flag-value

# Test unset env var uses default
unset ENV_VAR && <cli> <command>
```

Document which env vars are supported and their precedence relative to flags and config files.

### 9. Verify pipe and redirect behavior

Test that the CLI works correctly in pipelines:

```bash
# stdout is pipeable
<cli> <command> | grep "pattern"

# stdin is accepted (if applicable)
echo "input" | <cli> <command>

# stderr separate from stdout
<cli> <command> > stdout.txt 2> stderr.txt

# Exit code propagates correctly in pipes
<cli> <command> | false
echo "${PIPESTATUS[0]}"
```

Check that:
- Output is not corrupted when piped
- Progress indicators / spinners are suppressed when stdout is not a TTY
- Colors are disabled when not a TTY (or `--no-color` works)

### 10. Report results

Produce a summary in this format:

```
## CLI QA Walkthrough Report

**Tool**: <cli-name> <version>
**Date**: <today>
**Test cases**: N total, P passed, F failed, S skipped

### Results

| ID | Command | Expected | Actual | Status |
|----|---------|----------|--------|--------|
| 1 | `<cmd>` | exit 0, output "OK" | exit 0, output "OK" | PASS |
| 2 | `<cmd>` | exit 1, stderr error | exit 0, no error | FAIL |
| ... | ... | ... | ... | ... |

### Failures Detail

#### [ID] <brief description>
- **Command**: `<full command>`
- **Expected**: <what should happen>
- **Actual**: <what happened>
- **Severity**: critical / major / minor

### --help Completeness

| Command | Complete? | Missing |
|---------|-----------|---------|
| `<cmd>` | Yes | — |
| `<sub>` | No | Examples, exit codes |

### Environment Variables

| Variable | Documented? | Works? | Precedence correct? |
|----------|-------------|--------|---------------------|
| `VAR_X` | Yes | Yes | Yes |

### Summary

- **Overall**: PASS / FAIL
- **Blockers**: <count and brief list>
- **Recommendations**: <brief list>
```

---

## Common Mistakes

- Not capturing stderr separately from stdout (use `2>` redirects)
- Forgetting to check exit codes (always run `echo $?` after)
- Testing only happy paths without error scenarios
- Not verifying flag precedence over environment variables
- Assuming TTY behavior when output is piped
- Not testing with `--help` on every subcommand
- Skipping conflicting flag combinations
- Not recording the exact commands run (makes failures non-reproducible)
