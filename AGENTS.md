# Codex Working Guidelines

This is a long-term project. Keep changes simple, secure, maintainable and proportional to the task.

## Before changing code
- Inspect the relevant existing code and conventions.
- Read the relevant parts of `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`; don't assume proposals are finalized.
- If requirements are unclear or a change has significant consequences, briefly explain options and ask. Otherwise, proceed without unnecessary questions.

## While working
- Prefer small, focused changes. Reuse existing patterns; avoid premature abstractions, needless dependencies and unrelated refactors.
- Respect module boundaries and enforce access control on the server/database, not just in the UI.
- Never commit secrets or expose privileged credentials to clients.
- Do not introduce paid services, modify production data, perform destructive migrations or deploy to production without explicit approval.
- For substantial changes to authentication, database structure, deployment or shared interfaces, explain the impact before proceeding.

## After changes
- Run checks appropriate to the change (for example type checks, lint or tests). Never claim a check passed unless it ran.
- Summarize in simple Chinese: what changed, what was tested, and any remaining risks or decisions.
- When an agreed requirement or architectural decision changes, update the relevant docs; keep unconfirmed ideas clearly marked as proposals.

## Testing Strategy
- Prefer existing automated tests over manual browser testing or Computer Use.
- Run only relevant tests for routine changes; run the full regression suite at major checkpoints or before important releases.
- Add focused tests for new features and critical bug fixes. Do not enforce TDD or unnecessary test coverage.
- Never run tests that modify production data. Use isolated test environments.
- Keep test reports concise; inspect detailed logs only when tests fail.

These guidelines are defaults, not rigid rules. Suggest better approaches when justified, and explain the tradeoffs.

<!-- CODEGRAPH_START -->
## CodeGraph

- This project has a local `.codegraph/` index. Use CodeGraph before text searches or file reads when locating or understanding code.
- Prefer `codegraph_explore` with `projectPath` set to this repository's absolute path; name the relevant symbols or files in the query.
- CLI fallback: `codegraph explore "<symbols or question>"`. Run `codegraph sync` after changes; use `codegraph status` to inspect freshness.
- On a new checkout, run `codegraph init` once. The local index is ignored by Git. Reuse the existing global installation; do not add a project dependency or download models.
- Index results are navigation aids; source code and database migrations remain authoritative, especially for SQL/RLS which this index does not currently cover.
<!-- CODEGRAPH_END -->
