Use this file only as a dispatcher for project bootstrap.

1. If the target project path is missing, ask for it first.
2. Run `corgispec bootstrap --target /path/to/project --mode auto`.
3. If the user already provided a schema, include `--schema <schema>`.
4. Do not reconstruct the install workflow from README files.
5. Do not run separate user-level and project-level install steps unless bootstrap explicitly fails and tells you what is missing.
6. Read `openspec/.opsx-install-report.md` and summarize whether bootstrap succeeded, stopped, or failed.
7. If bootstrap reports a legacy approval gate, ask that exact approval question and rerun after the user answers.
