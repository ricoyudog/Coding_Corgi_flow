---
name: openspec-propose
description: Propose a new change with all artifacts generated in one step. Use when the user wants to quickly describe what they want to build and get a complete proposal with design, specs, and tasks ready for implementation.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.3.0"
---

Propose a new change - create the change and generate all artifacts in one step.

I'll create a change with artifacts:
- proposal.md (what & why)
- design.md (how)
- tasks.md (implementation steps)

When ready to implement, run /opsx-apply

---

**Input**: The user's request should include a change name (kebab-case) OR a description of what they want to build.

**Steps**

1. **If no clear input provided, ask what they want to build**

   Use the **AskUserQuestion tool** (open-ended, no preset options) to ask:
   > "What change do you want to work on? Describe what you want to build or fix."

   From their description, derive a kebab-case name (e.g., "add user authentication" → `add-user-auth`).

   **IMPORTANT**: Do NOT proceed without understanding what the user wants to build.

1.3 **Check isolation mode and set up worktree (if configured)**

   Read `openspec/config.yaml` and check for `isolation` settings:

   ```yaml
   # Worktree isolation config (optional)
   isolation:
     mode: worktree    # worktree | none (default: none)
     root: .worktrees  # worktree root directory (default: .worktrees)
     branch_prefix: feat/  # feature branch prefix (default: feat/)
   ```

   **If `isolation.mode` is `worktree`:**
   - Derive worktree path: `<root>/<name>` (e.g., `.worktrees/add-fart-tracking`)
   - Derive branch name: `<branch_prefix><name>` (e.g., `feat/add-fart-tracking`)
   - Check if the worktree already exists:
     ```bash
     git worktree list --porcelain 2>/dev/null | grep "worktree.*/<name>$"
     ```
   - If worktree exists → reuse it (announce: `Reusing existing worktree at <path>`)
   - If worktree does not exist → create it:
     ```bash
     git worktree add <root>/<name> -b <branch_prefix><name>
     ```
   - **From this point on, ALL subsequent steps run inside the worktree.** Use the Bash tool's `workdir` parameter set to the absolute worktree path for every command. File reads and writes also use absolute paths within the worktree.
   - Announce: `Worktree created at <path> (branch: <branch_name>)`

   **If `isolation.mode` is `none` or `isolation` section is missing:**
   - Continue as today — work in the current directory
   - Skip all worktree-related steps below (1.3, 6.5)

1.5 **Check for an existing change directory and issue tracking**

   Before running `openspec new change`, check whether `openspec/changes/<name>/` already exists.

   - If the change exists and has `.gitlab.yaml`, announce that GitLab tracking is already configured and skip GitLab issue creation later.
   - If the change exists without `.gitlab.yaml`, reuse the change directory and allow Step 6 to create issues later.
   - If the change does not exist, continue to Step 2.

2. **Create or reuse the change directory**
   ```bash
   openspec new change "<name>"
   ```
   If the change does not already exist, this creates a scaffolded change at `openspec/changes/<name>/` with `.openspec.yaml`.
   If it already exists, reuse the existing change directory instead of creating a new one.

3. **Get the artifact build order**
   ```bash
   openspec status --change "<name>" --json
   ```
   Parse the JSON to get:
   - `applyRequires`: array of artifact IDs needed before implementation (e.g., `["tasks"]`)
   - `artifacts`: list of all artifacts with their status and dependencies

4. **Create artifacts in sequence until apply-ready**

   Use the **TodoWrite tool** to track progress through the artifacts.

   Loop through artifacts in dependency order (artifacts with no pending dependencies first):

   a. **For each artifact that is `ready` (dependencies satisfied)**:
      - Get instructions:
        ```bash
        openspec instructions <artifact-id> --change "<name>" --json
        ```
      - The instructions JSON includes:
        - `context`: Project background (constraints for you - do NOT include in output)
        - `rules`: Artifact-specific rules (constraints for you - do NOT include in output)
        - `template`: The structure to use for your output file
        - `instruction`: Schema-specific guidance for this artifact type
        - `outputPath`: Where to write the artifact
        - `dependencies`: Completed artifacts to read for context
      - Read any completed dependency files for context
      - Create the artifact file using `template` as the structure
      - Apply `context` and `rules` as constraints - but do NOT copy them into the file
      - Show brief progress: "Created <artifact-id>"

   b. **Continue until all `applyRequires` artifacts are complete**
      - After creating each artifact, re-run `openspec status --change "<name>" --json`
      - Check if every artifact ID in `applyRequires` has `status: "done"` in the artifacts array
      - Stop when all `applyRequires` artifacts are done

   c. **If an artifact requires user input** (unclear context):
      - Use **AskUserQuestion tool** to clarify
      - Then continue with creation

5. **Show final status**
   ```bash
   openspec status --change "<name>"
   ```

6. **Create GitLab issues (if glab available and tracking not already configured)**

   a. Check glab:
      ```bash
      glab auth status 2>&1
      ```

   b. If the change already has `.gitlab.yaml`, skip issue creation.

    c. If glab is available and tracking is not yet configured:
       - Read `proposal.md` and `tasks.md`
       - Parse each `## N. Group Name` heading in `tasks.md` and its child checkbox items
       - Build one parent issue body with:
         - `**Objectives**` from the proposal's Why section
         - `**Background**` from the proposal's What Changes section
         - `**Acceptance Criteria**` — for each spec file in `specs/**/*.md`, extract each `### Requirement:` name and its first `#### Scenario:` as a one-line bullet. Format: `- **Requirement name**: WHEN condition → THEN outcome`
         - `**Key Design Decisions**` — from `design.md`, extract each `### N. Decision Title` heading and its `**Decision:**` line as a bullet. Format: `- **Decision heading**: decision text`. If `design.md` doesn't exist, omit this section.
          - `**Task Groups**` table with a Status column:
            ```
            | Group | Name | Issue | Status |
            |-------|------|-------|--------|
            | 1 | Setup | #<child_1_iid> | backlog |
            | 2 | Core Implementation | #<child_2_iid> | backlog |
            ```
            All groups start with Status `backlog`. Status values: `backlog` → `in-progress` → `review` → `done`.
          - `**Progress:**` 0/N groups completed
         - `**Conclusion**`
         - `**References**` including the change path
       - Create the parent issue:
         ```bash
         glab issue create --title "feat(<scope>): <change-name>" --description "$PARENT_BODY" --label "workflow::backlog"
         ```
       - For each Task Group, build a child issue body using the doc-conv#32 style sections:
         - `**Objectives**`
         - `**Todo**`
         - `**Estimated Completion Date:** TBD`
         - `**Conclusion**`
         - `**References**` with the parent issue and change path
       - Create one child issue per Task Group:
         ```bash
         glab issue create --title "Group N: <group-name> [<change-name>]" --description "$CHILD_BODY" --label "workflow::todo"
         ```
       - Update the parent issue description so its Task Groups table includes the created child issue IIDs
         ```bash
         glab issue update <parent_iid> --description "$UPDATED_PARENT_BODY"
         ```
       - Save `.gitlab.yaml` in the change directory:
         ```yaml
         parent:
           iid: <parent_iid>
           url: <parent_url>
         groups:
           - number: 1
             name: "Setup"
             iid: <child_1_iid>
             url: <child_1_url>
           - number: 2
             name: "Core"
             iid: <child_2_iid>
             url: <child_2_url>
         ```
       - Post an initial note on the parent issue:
         ```bash
         glab issue note <parent_iid> --message "Planning complete. This change has one parent issue and one child issue per Task Group. Run /opsx-apply to begin implementation."
         ```
       - Update `proposal.md` in the `## GitLab Issue` section with the parent issue link

6.5 **Save worktree metadata (if isolation mode is worktree)**

   If worktree isolation is active (from step 1.3), write `.worktree.yaml` in the change directory (`openspec/changes/<name>/.worktree.yaml`):
   ```yaml
   path: .worktrees/<name>
   branch: feat/<name>
   created: <ISO-8601-timestamp>
   ```

   Also add worktree info to the parent issue. In the parent issue body's **References** section, include:
   ```markdown
   - Worktree: `.worktrees/<name>` (branch: `feat/<name>`)
   ```
   Update the parent issue description:
   ```bash
   glab issue update <parent_iid> --description "$UPDATED_PARENT_WITH_WORKTREE"
   ```

   d. If glab is unavailable:
      - Print a warning that GitLab issue creation is being skipped
      - Do not block artifact creation or readiness for implementation

**Output**

After completing all artifacts, summarize:
- Change name and location
- List of artifacts created with brief descriptions
- What's ready: "All artifacts created! Ready for implementation."
- GitLab tracking status: parent issue created or skipped
- Worktree status: path and branch (if isolation active), or "none" (if isolation inactive)
- Prompt: "Run `/opsx-apply` or ask me to implement to start working on the tasks."

**Artifact Creation Guidelines**

- Follow the `instruction` field from `openspec instructions` for each artifact type
- The schema defines what each artifact should contain - follow it
- Read dependency artifacts for context before creating new ones
- Use `template` as the structure for your output file - fill in its sections
- **IMPORTANT**: `context` and `rules` are constraints for YOU, not content for the file
  - Do NOT copy `<context>`, `<rules>`, `<project_context>` blocks into the artifact
  - These guide what you write, but should never appear in the output

**Guardrails**
- Create ALL artifacts needed for implementation (as defined by schema's `apply.requires`)
- Always read dependency artifacts before creating a new one
- If context is critically unclear, ask the user - but prefer making reasonable decisions to keep momentum
- Reuse an existing change when appropriate; do not blindly fail on an existing change directory
- If `.gitlab.yaml` already exists, do not create duplicate issues
- Verify each artifact file exists after writing before proceeding to next
