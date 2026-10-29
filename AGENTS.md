# Agent Guidelines

Long-term solo project (pnpm monorepo: `apps/web` main site, `apps/club` Club app, Supabase database). Keep changes small, secure and proportional to the task. App-specific rules live in each app's `AGENTS.md`.

## Working
- Read the code you change and its callers first; reuse existing patterns. No speculative abstractions, new dependencies or unrelated refactors.
- Ask before changes with significant consequences or unclear requirements; otherwise proceed.
- Check `docs/DECISIONS.md` and the relevant requirements doc only when a task touches scope, product behaviour or an earlier decision. Don't treat proposals as decided.
- After changes, report in simple Chinese: what changed, what was tested (only checks that actually ran), remaining risks.
- When an agreed requirement or architecture changes, update the matching doc: `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/PERFORMANCE.md`. Keep dated history in docs, not here.

## Security and data (never relax)
- Enforce access control on the server and database (Worker checks + RLS), never only in the UI.
- Never commit secrets or expose privileged keys to clients; Workers use only the publishable key plus the user's token.
- No paid services, production data changes or destructive migrations without explicit approval in the current task.
- Production migrations are applied manually. Never rewrite or rename an applied migration; finalize filenames before applying.
- Explain the impact before substantial changes to authentication, database structure, deployment or shared interfaces.

## Delivery (solo, direct to main)
- The owner pushes to `main`; GitHub Actions runs the affected checks and deploys only apps whose shipped files changed, only after every check passes. Docs, tests, scripts, CI and migrations never deploy. No PRs, branch protection or approval steps.
- Agents push, deploy, apply migrations or change CI secrets/variables only when the owner asks in the current task.
- Club deploys are blocked until the repository Variable `CLUB_SCHEMA_VERSION` equals the newest migration filename.
- Details: `docs/TESTING.md` (first section is the current workflow).

## Testing
- Before suggesting a push run `pnpm test:affected` (covers uncommitted and unpushed work). Run `pnpm test:full` or the manual full CI run before important releases.
- Add focused tests for new features and bug fixes that encode why the behaviour matters; no TDD mandate or coverage targets.
- Prefer Playwright over manual or Computer Use clicking; use manual checks only for visual or motion issues automation can't judge.
- SQL fixtures run only via `pnpm test:db` on disposable local/CI PostgreSQL. Auth, database and important Club flows also need `pnpm test:integration` (its own local Supabase and synthetic data). Never point any test at the hosted project or production keys.
- Run fast checks first and real integration once changes are stable; on failure fix the cause and rerun focused tests. Never skip security, database or regression checks to save time.

<!-- CODEGRAPH_START -->
## CodeGraph

- This project has a local `.codegraph/` index. Use CodeGraph before text searches or file reads when locating or understanding code.
- Prefer `codegraph_explore` with `projectPath` set to this repository's absolute path; name the relevant symbols or files in the query.
- CLI fallback: `codegraph explore "<symbols or question>"`. Run `codegraph sync` after changes; use `codegraph status` to inspect freshness.
- On a new checkout, run `codegraph init` once. The local index is ignored by Git. Reuse the existing global installation; do not add a project dependency or download models.
- Index results are navigation aids; source code and database migrations remain authoritative, especially for SQL/RLS which this index does not currently cover.
<!-- CODEGRAPH_END -->
