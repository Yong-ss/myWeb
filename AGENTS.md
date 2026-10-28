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

## Delivery (solo, direct to main)
- The owner pushes directly to `main`; GitHub Actions tests, then deploys affected apps only after every check succeeds. Do not add PRs, branch protection or approval steps.
- Agents never push, deploy, apply migrations or change CI secrets/variables unless the owner explicitly asks in the current task.
- Production migrations are always manual. Club deploys are blocked until the repository Variable `CLUB_SCHEMA_VERSION` equals the newest migration filename.
- Before suggesting a push, run `pnpm test:affected` (covers uncommitted and unpushed commits). Current delivery rules live in `docs/TESTING.md` first section; keep dated history in docs, not in AGENTS.md.

## Testing Strategy
- Prefer existing automated tests over manual browser testing or Computer Use.
- Run only relevant tests for routine changes; run the full regression suite at major checkpoints or before important releases.
- Add focused tests for new features and critical bug fixes. Do not enforce TDD or unnecessary test coverage.
- Never run tests that modify production data. Use isolated test environments.
- Keep test reports concise; inspect detailed logs only when tests fail.
- During C/D/E, add focused tests for each completed feature and use `pnpm test:affected` for routine verification. Run `pnpm test:full` (or the manual full CI run) at significant stage checkpoints and before important releases; run the complete suite after A–E are finished.
- Browser regression uses Playwright by default. Reserve Computer Use for visual issues or gaps automation cannot cover; do not repeatedly click through flows already tested automatically.
- SQL fixtures must use `pnpm test:db` against disposable local/CI PostgreSQL only. Never run the SQL fixtures against the production Supabase project, even with a rollback.
- Authentication, database and important Club flows also require `pnpm test:integration`, which starts its own local Supabase/HTTPS Worker and synthetic data. Simple styling changes retain the fast tests. Never link this test stack to a hosted project or substitute production URLs/keys.

### Testing and Delivery Efficiency
- Batch related code, migration, and test changes before expensive verification.
- Run fast, relevant checks first; run real integration tests once changes are reasonably stable.
- If a test fails, diagnose and fix the cause, then rerun focused tests before repeating the full suite.
- Reuse running test environments when safe; avoid unnecessary rebuilds and repeated setup/cleanup.
- Finalize migration filenames before applying them to production; never rename an already applied migration.
- Avoid triggering redundant CI runs solely for documentation or metadata changes when no relevant code or configuration changed.
- Never skip necessary security, database, or regression checks to save time.

These guidelines are defaults, not rigid rules. Suggest better approaches when justified, and explain the tradeoffs.

<!-- CODEGRAPH_START -->
## CodeGraph

- This project has a local `.codegraph/` index. Use CodeGraph before text searches or file reads when locating or understanding code.
- Prefer `codegraph_explore` with `projectPath` set to this repository's absolute path; name the relevant symbols or files in the query.
- CLI fallback: `codegraph explore "<symbols or question>"`. Run `codegraph sync` after changes; use `codegraph status` to inspect freshness.
- On a new checkout, run `codegraph init` once. The local index is ignored by Git. Reuse the existing global installation; do not add a project dependency or download models.
- Index results are navigation aids; source code and database migrations remain authoritative, especially for SQL/RLS which this index does not currently cover.
<!-- CODEGRAPH_END -->
