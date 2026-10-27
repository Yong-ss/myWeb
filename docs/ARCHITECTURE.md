# SquirrelAPI — Architecture

## Automated testing — 2026-10-27

Node.js tests and `club:check` remain primary. Playwright runs four critical Club browser flows against localhost static assets and per-test API mocks with external requests blocked. PostgreSQL 17 in CI executes actual migrations and existing SQL suites using a minimal test Auth interface, transactions and savepoints; no production Supabase access, credentials or deployment. The local SQL runner permits only a loopback `squirrelapi_test` database and each SQL suite independently rejects other database names.

GitHub Actions selects affected app checks, SQL and browser specs; shared/unknown infrastructure changes, manual full runs and release/checkpoint tags select all checks. One Linux job, ten-minute timeout, concurrency cancellation, one Chromium and failure-only traces/artifacts bound cost and output. This supersedes earlier deferred hosted-CI notes. See TESTING.md for commands and integration gaps.

## Club stage B — 2026-10-27

Adds `/import`, GET `/api/import-context?date=...` and POST `/api/imports`. Shared dependency-free TypeScript validates v1 keys, types, bounds and explicit identity selections. Preview reads only authorized current-day data and identity candidates; no historical browsing or analysis interface is added. All private responses use no-store and existing session/membership checks; POST remains same-origin JSON. Club ID comes from server configuration.

Migration `20261027064338_club_atomic_import.sql` adds request/content hashes and an authenticated invoker RPC wrapping `club_private.commit_import`. Only this private SECURITY DEFINER function performs writes; it has an empty search_path, explicit actor/confirmed-email/active-membership checks, club advisory transaction locking, membership row locking and independent payload validation. Direct table writes remain revoked; no service-role runtime credential is used.

Commit checks idempotency and the expected current snapshot before resolving explicit identities, merging or replacing rows, preserving old revisions, publishing the new current version and writing audit identity mappings in one transaction. Null values replace explicitly, not zero-fill or inheritance. Identical effective snapshots are skipped. Original inputs remain separate from corrected snapshots. Local fixture browser verification does not contact production Auth or write real players.

## Club stage A — 2026-10-27

`apps/club` is an independent Next.js static export and Cloudflare Worker (`squirrelapi-club`, planned domain `club.squirrelapi.org`). It reuses the pinned web toolchain without new libraries. Only `/api/login`, `/api/account`, `/api/logout` exist. Club uses the same Supabase Auth project, but separate `__Host-club_access` / `__Host-club_refresh` HttpOnly, Secure, SameSite=Strict host-only cookies. Local session verification requires HTTPS. Main-site code and Auth settings are unchanged.

Every account request verifies the Auth user then queries their current active `club_memberships` row using their access token and the configured `CLUB_ID`. Revocation applies without waiting for token expiry. There is no Super Admin business-data bypass, service-role key, registration UI, invitation flow or business API.

Seven `public.club_*` tables use explicit SELECT grants for authenticated users, RLS based on current active membership and composite tenant foreign keys. All client writes are revoked; stage B must add narrowly authorized transactional import operations and corresponding checks. Snapshots have daily revisions and one current version per club/date. Existing owner initialization is explicit, not first-user claiming. Audit entries and historical rows have no client update/delete grants.

Migration history lives in `supabase/migrations/`; rollback-only permission tests live in `supabase/tests/`. No local Postgres runtime was installed: database DDL and RLS are verified in rollback-only transactions against the existing Supabase project before and after migration. Game timezone remains unset pending confirmation. A security scan still reports the pre-existing disabled leaked-password protection setting; Auth configuration is not changed.

## Phase 2 — 2026-10-27 (supersedes current phase 1 boundaries below)
Next.js still exports static pages. A small apps/web/worker/index.ts handles only /api/login, /api/account and /api/logout, calling Supabase Auth directly without a new SDK. Cloudflare assets serve all other paths. Account HTML is a public shell; private account data comes only from the server-verified API. HttpOnly, Secure (HTTPS), SameSite=Strict host-only cookies carry sessions; POST requires same-origin JSON. The Worker checks the confirmed user against OWNER_USER_ID; API responses use no-store. No service-role key or business tables.

Preview and production use the existing free Supabase project, so Auth accounts/settings are shared, not isolated test data. Host-only cookies do not share login between preview and production. Both Worker configurations include the Auth API with their own OWNER_USER_ID setting. The user verified preview login/session/logout and approved production rollout. While only the owner uses the site, routine updates may publish directly to production after relevant checks; preview is optional.

Auth requests now consume Workers Free dynamic request/CPU quotas; assets remain static. No paid bindings. Password recovery by email has not been implemented or verified; default Supabase email is not a production delivery guarantee. Logout clears cookies and revokes refresh access; an already issued access token can remain valid until expiry. Cross-app sessions, Admin and business permissions remain deferred.

Updated: 2026-10-26. Phase 1 confirmed by user.

## Current architecture
- Private Monorepo Yong-ss/myWeb; actual local folder: myWeb.
- pnpm workspace, one application: apps/web.
- Next.js App Router + TypeScript + plain CSS; static export to apps/web/out.
- Cloudflare Workers Static Assets, local Wrangler preview, custom 404.
- Separate manual deployments from the same app: squirrelapi-web at https://squirrelapi.org (wrangler.production.jsonc) and squirrelapi-web-preview on workers.dev (wrangler.jsonc). No paid bindings or automatic publishing.
- Root commands: lint, typecheck, build, check, preview, deploy:check and deploy:preview.
- Local quality checks only; hosted CI deferred to avoid adding account/billing configuration.
- Node.js 24, pinned direct dependencies and lockfile.
- scripts/env.ps1 directs caches/config/temp into Global_Env; project files remain in workspace.

## Boundaries
No login, Admin, backend, database, registry, shared packages or other applications in phase 1. Homepage correctly shows zero available apps. Static output contains no secrets. noindex is not access control.

## Future direction, not implemented
Add apps/<name> when there is a real application; prefer subdomains for independent deployments and paths for small in-app features. Each application needs its own deployment configuration. Shared packages follow actual reuse.

Prefer one Supabase project with shared identity. Data separation needs database permissions and RLS, not merely table prefixes. Shared Auth does not automatically share sessions across subdomains. Admin can initially live at /admin. Add a lightweight Worker backend only for real server-side needs.

## Pending decisions and validation
Dynamic hosting compatibility/CPU costs, auth, email, backups and cross-app sessions remain future work. Workers Free Active was confirmed from the user's subscription screenshot on 2026-10-26. HTTPS homepage/assets/custom 404 checks passed for the preview and the user-authorized root domain deployment. Remaining account quotas and mainland China access are not verified. RM0 means staying within free limits and accepting reduced availability or disabled functions on exhaustion. Search indexing remains disabled pending a separate decision.
