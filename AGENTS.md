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
- Production migrations are applied manually. Never rewrite or rename an applied migration; finalize filenames before applying. Apply only the original file (never retyped SQL) and verify with `scripts/migration-checksums.mjs` before updating `CLUB_SCHEMA_VERSION`.
- Explain the impact before substantial changes to authentication, database structure, deployment or shared interfaces.

## Delivery (solo, direct to main)
- The owner pushes to `main`; GitHub Actions runs the affected checks and deploys only apps whose shipped files changed, only after every check passes. Docs, tests, scripts, CI and migrations never deploy. No PRs, branch protection or approval steps.
- Agents push, deploy, apply migrations or change CI secrets/variables only when the owner asks in the current task.
- Club deploys are blocked until the repository Variable `CLUB_SCHEMA_VERSION` equals the newest migration filename.
- Details: `docs/TESTING.md` (first section is the current workflow).

## Testing
- During development, run the smallest affected checks first; do not run a full regression after every edit. Run real integration once the relevant changes are stable.
- After a failure, diagnose and fix the cause, then rerun the failing and directly affected checks. Broaden testing only when the change or new evidence warrants it.
- Reuse successful results when the tested code, dependencies, configuration and relevant environment are unchanged. Record the covered version/scope and outcome; a repeated report, approval or deployment request alone is not a reason to rerun checks.
- Before suggesting a push, ensure `pnpm test:affected` covers the final uncommitted and unpushed work; reuse results that still cover it. Perform the necessary final validation once, not at every checkpoint. Important releases require `pnpm test:full` or the manual full CI run under `docs/TESTING.md`; avoid duplicating unchanged full suites locally and in CI unless required by that workflow or new evidence.
- Add focused tests for new features and bug fixes that encode why the behaviour matters; no TDD mandate or coverage targets.
- Prefer Playwright over manual or Computer Use clicking; use manual checks only for visual or motion issues automation can't judge.
- SQL fixtures run only via `pnpm test:db` on disposable local/CI PostgreSQL. Auth, database and important Club flows also need `pnpm test:integration` (its own local Supabase and synthetic data). Never point any test at the hosted project or production keys.
- High-risk permission, authentication and database changes require targeted security tests; changes with migrations also require `pnpm test:compat` before push, as specified in `docs/TESTING.md`. Never skip required security, database, compatibility or regression checks to save time.
- Do not repeat a comprehensive security review without relevant code changes, new evidence or an unresolved concern; review the affected area instead.
- GitHub CI remains the automatic deployment gate: all required checks must pass; never bypass it. Report successful checks as a concise summary, and inspect detailed logs when a check fails rather than repeatedly reading successful logs.

<!-- CODEGRAPH_START -->
## CodeGraph

- This project has a local `.codegraph/` index. Use CodeGraph before text searches or file reads when locating or understanding code.
- Prefer `codegraph_explore` with `projectPath` set to this repository's absolute path; name the relevant symbols or files in the query.
- CLI fallback: `codegraph explore "<symbols or question>"`. Run `codegraph sync` after changes; use `codegraph status` to inspect freshness.
- On a new checkout, run `codegraph init` once. The local index is ignored by Git. Reuse the existing global installation; do not add a project dependency or download models.
- Index results are navigation aids; source code and database migrations remain authoritative, especially for SQL/RLS which this index does not currently cover.
<!-- CODEGRAPH_END -->
