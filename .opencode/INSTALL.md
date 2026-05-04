# OpenSpec GitFlow — Agent Bootstrap

Use this file as the entry point when an LLM agent is bootstrapping OpenSpec GitFlow into a target project.

## Steps

1. **Clone the repo** (if not already inside it):
   ```bash
   git clone -b feat/openspec-llm-memory https://github.com/ricoyudog/Coding_Corgi_flow.git /tmp/Coding_Corgi_flow
   cd /tmp/Coding_Corgi_flow
   ```

2. **Build corgispec**:
   ```bash
   cd packages/corgispec
   npm install
   npm run build
   cd ../..
   ```

3. **Ask for the target project path** if not already provided.

4. **Run bootstrap**:
   ```bash
   node packages/corgispec/dist/bin.js bootstrap --target /path/to/project --mode auto
   ```
   If the user already provided a schema, include `--schema <schema>`.

5. **Read the report** at `openspec/.corgi-install-report.md` in the target project and summarize whether bootstrap succeeded, stopped, or failed.

6. If bootstrap reports a legacy approval gate, ask that exact approval question and rerun after the user answers.

## Rules

- Do not reconstruct the install workflow from README files.
- Do not run separate user-level and project-level install steps unless bootstrap explicitly fails and tells you what is missing.
