## ADDED Requirements

### Requirement: User-visible brand text uses "Corgi" exclusively

All text displayed to end users through command panels, CLI help output, skill execution descriptions, and installed asset files SHALL use "Corgi" as the brand name. No occurrence of "OpenSpec" SHALL appear in user-facing text that refers to this project's workflow.

#### Scenario: Command panel description displays "Corgi"

- **WHEN** a user opens the command panel in OpenCode or Claude Code and views any `/corgi-*` command
- **THEN** the command description text contains "Corgi" and does not contain "OpenSpec" or "OPSX"

#### Scenario: CLI help output displays "Corgi"

- **WHEN** a user runs `corgispec --help` or any subcommand help
- **THEN** the output text contains "Corgi" in its description and does not contain "OpenSpec"

#### Scenario: Skill execution description displays "Corgi"

- **WHEN** an AI agent loads a `corgispec-*` skill and presents its description to the user
- **THEN** the skill description text references "Corgi" and does not contain "OpenSpec" or "opsx"

### Requirement: Install templates produce clean brand output

The `corgispec install` command SHALL copy asset templates into target projects that contain only "Corgi" brand text. No occurrence of "OpenSpec", "OPSX", or "opsx" SHALL appear in any file installed by the CLI.

#### Scenario: Fresh install produces zero brand contamination

- **WHEN** a user runs `corgispec install --mode fresh --path <target>`
- **THEN** running `grep -rni "OpenSpec\|OPSX\|opsx" <target>` on all installed files produces zero results

#### Scenario: Asset templates are consistent with deployed skill files

- **WHEN** comparing `packages/corgispec/assets/skills/` content against `.opencode/skills/` for matching skill paths
- **THEN** the brand text substitutions (description, author, body references) are identical between asset templates and deployed files

### Requirement: Three-platform skill sync maintained

After the brand replacement, the skill files across `.opencode/skills/`, `.claude/skills/`, and `.codex/skills.backup/` SHALL contain identical brand text for all matching skill paths.

#### Scenario: Cross-platform brand consistency verified

- **WHEN** comparing SKILL.md content across the three platform directories for any `corgispec-*` skill
- **THEN** no file contains "OpenSpec", "OPSX", or "opsx" in any platform directory

#### Scenario: Author metadata is consistent

- **WHEN** inspecting `metadata.author` fields in SKILL.md frontmatter across all three platform directories
- **THEN** all author values read `"corgispec"` — no `"openspec"` values remain

### Requirement: Directory paths and code identifiers preserved

The `openspec/` directory path convention and TypeScript code identifiers SHALL NOT be modified by this change.

#### Scenario: Directory path references remain intact

- **WHEN** running `grep -rn "openspec/" packages/corgispec/src/`
- **THEN** all path references to `openspec/config.yaml`, `openspec/changes/`, `openspec/schemas/`, `openspec/specs/` remain present and unchanged

#### Scenario: TypeScript identifiers unchanged

- **WHEN** searching for `OpenSpecConfig` and `initializeOpenSpec` in the TypeScript source
- **THEN** these identifiers exist unchanged (they are code names, not brand text)

### Requirement: External attribution preserved

References to the upstream Fission-AI/OpenSpec project SHALL remain unchanged. The distinction is: "OpenSpec" referring to the Fission AI project is preserved; "OpenSpec" referring to this project's workflow is replaced with "Corgi".

#### Scenario: Upstream project links preserved

- **WHEN** inspecting README.md for references to `https://github.com/Fission-AI/OpenSpec`
- **THEN** these URLs and their surrounding attribution context (e.g., "community extension of OpenSpec", "Built on OpenSpec by Fission AI") remain unchanged

#### Scenario: Self-referential brand text replaced

- **WHEN** inspecting README.md for "OpenSpec" text that describes this project's own workflow
- **THEN** such text has been replaced with "Corgi" (e.g., "OpenSpec GitFlow assets" → "Corgi GitFlow assets")
