# SquirrelAPI — Architecture

## Platform player counts (P3.1, local) — 2026-10-31

Migration `20261031111245_platform_player_counts.sql` replaces only the read-only `platform_overview` implementation, retaining its platform gate, signature and existing grants. Each club selects its latest current, non-deleted snapshot and aggregates `club_roster_presence` (the same RPC as the member list). `player_counts` partitions present, temporary, confirmed departures, unconfirmed and other absent players; only `presence=left` can enter a departure category. Historical identities without an effective observation join the unconfirmed count; without any effective snapshot the entire breakdown is null. The existing `players` field remains the historical identity count, including identities retained after deletion. Account counts remain distinct active website accounts. No presence algorithm, history, RLS or MFA changes.

The overview emphasizes current presence and shows historical totals as secondary information; other categories use the existing Collapsible. Snapshot date and roster completeness remain visible. Unknown breakdowns (including responses from the older schema) never fall back to historical totals or zero. Counts describe the latest recorded evidence, not live game membership. The owner accepted P3.1; migration 20261031111245 was applied to production from the original file on 2026-10-31, with function checksum and unchanged execution grants verified before application release.

## Platform panel, read-only (P3) — 2026-10-31

`/admin` (feature `admin`, header link 平台管理) has four read-only tabs: overview, users and roles, roles and permissions, platform log. Routes `/api/admin/{overview,users,roles,activity}` are marked `platform: true` and need `platform.read`, which is registered with `platform` scope only. A platform permission never satisfies a club route, and club permissions never satisfy a platform route; `club_my_access` returns them as separate lists. `club_private.can_platform()` is the platform decision point: in P3 only the active Super Admin (aal2 session from a confirmed device) passes. Every `public.platform_*` RPC starts with that check, and `supabase/tests/platform_admin.sql` fails if a new one does not. Readers return only whitelisted `auth.users` fields (email, confirmation, created, last sign-in). Effective permissions use the same rule as `can()`, and the tests compare the two. Alliances are reported as `null` (not enabled) until P6.

`platform_audit_events` is append-only and closed to every API role. One row trigger logs inserts, updates and deletes on memberships, roles, role permissions, the permission registry, the Super Admin list and confirmed devices, with old/new rows, the app user (`actor_id`, null for SQL Editor) and the database login (`via`). P4/P7 writers are therefore logged without extra code. Device confirmations made before P3 were copied in with their original time.

## Club authorization switch and Super Admin MFA (P2) — 2026-10-30

Migration `20261030093737_club_authz_switch.sql` routes every decision through `can()`. The five write functions (`commit_import`, `manage_alias`, `delete_import_date`, `resolve_absence`, `club_rename`) are their previous definitions with only the hard-coded owner/admin check replaced by `club_private.require(<club>, <permission>)`. `tests/migration-auth-switch.test.mjs` fails if any other byte changes. Every permissive business SELECT policy now uses `club_id in (select club_private.readable_clubs(...))`, evaluated once per statement; `club_authz_switch.sql` rejects any other permissive policy except the caller's own membership row. `club_memberships` drops the owner/admin check and has the primary key `(club_id,user_id,role)`. A user may hold several club roles, with permissions merged as a union. The one-active-owner index, the role scope trigger and `can()`'s own scope recheck are unchanged.

The Worker reads `rpc/club_my_access` once per request (replacing the `club_memberships` query): permissions, roles, `super_admin`, `super_admin_active`. Each business route declares the permission per method in the route table; undeclared methods are denied. Unknown keys from the database are dropped. `X-Club-Scope` includes the AAL and permission list, so cached reads are discarded whenever access changes. `/api/account` returns `roles`, `permissions`, `super_admin`, `mfa_verified`; the header label is display-only.

MFA uses Supabase Auth TOTP through `/api/mfa` (Super Admin only). The page shows the QR code and secret once; the code goes to Auth's challenge/verify, and the returned aal2 session replaces the HttpOnly cookie. Nothing is logged or stored. When the account already has a verified factor, enrolling another factor needs aal2, and Auth itself requires aal2 to remove one. First activation needs a trusted confirmation: a password thief could bind a new TOTP and reach aal2, so powers also require the session to have been verified with a factor listed in `platform_super_admin_factors`. Only the owner can add one, in Supabase SQL Editor (`select club_private.trust_super_admin_factor('<id>');`, shown in Settings); no client role can execute it or read the table. `super_admin_active()` checks the JWT `aal`, then the live `auth.sessions` row named by `session_id` (aal2, not expired) and its still-verified, confirmed factor, so logout or removing the factor ends powers at once. Later logins need only TOTP. The confirmation function and table are also closed to `service_role` (the secret API key). Each confirmation row records the device name, bind time, confirmation time and the confirming database login, and cannot be updated, deleted or truncated. `super_admin_active()` returns before reading Auth tables for aal1 requests, because RLS calls it once per club per statement. Without MFA the Super Admin keeps only its ordinary memberships; with aal2 it reads and writes every club through the same RLS and RPCs, audited with its real `actor_id` and no email. Measured locally (80,000-row fixture, 3 alternating runs P1 vs P2 on the same machine): roster warm median 114→123 ms, paged history 111–138→109–154 ms, RLS plan 0.2→2.3 ms (5–10 ms before the aal1 early return). Re-run with `CLUB_PERFORMANCE=1` after deploying.

## Club authorization core (P1) — 2026-10-30

Migration `20261030051258_club_authz_core.sql` (additive) adds the permission registry `auth_permissions` (`kind` action/field, allowed scopes, read-only, sensitive), `auth_roles` (scope kind; `club_id` set only for a club's own custom role), `auth_role_permissions` and `platform_super_admins`. None of these tables has any client grant. Triggers keep registry identities and scopes immutable, reject a permission outside the role's scope, and reject club memberships whose role is not a club role or belongs to another club. Alliance-scoped permissions must be read-only.

`club_private.can(club, permission)` is the single decision point. Unregistered keys and unconfirmed emails are denied to everyone. An MFA-verified (`aal2`) Super Admin is allowed on every existing club. Otherwise access comes from an active membership role. `require()` locks the membership row and raises 42501; `readable_clubs()` is for RLS; `club_my_permissions()` is the Worker's one-call read. Only the last two are client-callable. Seeded `owner`/`admin` roles reproduce today's behaviour exactly (rename owner-only); no system role holds `audit.actor_email.read`.

P1 boundary: the five write functions, business RLS and the Worker still use the legacy owner/admin checks, and `club_memberships` keeps its `(club_id,user_id)` key and owner/admin check. Old Workers therefore never receive an unknown role. P2 switches all checks to the registry, relaxes the key for multiple roles and tests multiple roles per user.

Audit: the trigger stores no email for the Super Admin (`actor_kind:'super_admin'`), always keeps the real `actor_id`, ignores client-supplied markers and picks one role even with several memberships. Update, delete and truncate are blocked by trigger. Clients lose SELECT on `club_audit_events`; `club_activity` (same signature, now definer) is the only reader. It returns `actor_label`/`actor_kind`/`actor_role` per viewer: the Super Admin is identified by the current list, so older rows that stored an email are masked too. Only an MFA-verified Super Admin sees full identity. User-ID columns (`club_imports.submitted_by`, `club_player_aliases.confirmed_by`) are withheld by column grants, and new columns on those tables stay hidden until granted. `supabase/tests/club_authz.sql` fails if any client-readable column other than the caller's own `club_memberships.user_id` references `auth.users`. `can()` rechecks role scope and club ownership itself, so it does not rely on the membership trigger alone. `tests/integration/authz.spec.mjs` obtains `aal2` through real local TOTP and checks that forged or unsigned JWTs are rejected.

## Score trends — 2026-10-30

Club analytics uses `ClubScoreTrend` with the shared `components/ScoreTrend` and pure `lib/score-history` period grouping. Player history reuses the chart over its existing paged timeline. The existing authenticated members route has a read-only `trend=1` mode (bounded current snapshot/observed row embedding); per-date drawer comparisons reuse `score-growth` and the existing roster-presence API. No schema, write API, or permission change. Former ScoreGrowth/ScoreBridge presentation is retired; pure growth calculations remain.

## Club overview and analytics workspace — 2026-10-30

`/account` shows current snapshot status, confirmed member count, recent observed changes and a concise strength summary. `/analytics?view=growth|pathways` is registered in the shared private navigation and uses the existing analytics feature. Radix Tabs synchronize with URL navigation, including Back/Forward. The pathway view does not fetch the prior roster. Existing pure growth calculations and pathway counts remain unchanged; growth dates, formulas, complete sortable rankings, population charts and older overview detail are progressively disclosed. No API or database change.

Sections are dated and newest-first; a later section supersedes earlier ones. Current delivery and testing rules: `docs/TESTING.md` first section.

## Club module structure (current) — 2026-10-29

Feature-based modular monolith inside `apps/club`. `src/features/<feature>` (import, members, history, analytics, activity, settings, auth) owns its page, components, pure rules and tests; features never import each other. Shared layers: `src/domain` (member field contract, date/UUID validation, presence rules; depends on nothing), `src/lib` (data access, `clubApi`, refresh, brand) and `src/components` (UI primitives, layout, feedback), which never import features. `src/app/*/page.tsx` only re-exports a feature page; `src/app/error.tsx` isolates page crashes from the shell. The Worker keeps one handler per API, registered in the `index.ts` route table, with shared HTTP helpers in `worker/http.ts`; it imports only `domain/` and pure feature `.ts` modules. `src/architecture.test.mjs` enforces these rules and rejects circular imports. No API, database, auth or UI behaviour changed in this restructuring.

Follow-up (2026-10-29): `src/lib/navigation.ts` is the only list of private routes and sidebar entries. All client calls go through `clubApi`: 401 on a private page redirects to login, 403 stays and shows the server message, public pages never redirect. `error.tsx` clears cached reads before Next's `retry()`. Feature-only selectors in the shared stylesheets are scoped to the feature's page root with `:where()` (no specificity change, verified by a computed-style comparison); the architecture test rejects unscoped feature selectors.

UI system (2026-10-29): Club UI is shadcn/ui (Radix implementation, `radix-lyra` style) + Radix Primitives + Motion, styled with Tailwind v4 scoped to `apps/club` (`postcss.config.mjs`; `apps/web` has none). `src/app/globals.css` is the only CSS entry: it maps shadcn semantic variables onto the `--club-*` tokens in `src/styles/tokens.css` (still the source of truth). Shared components live in `src/components/ui` (one per responsibility); there are no other hand-written stylesheets (the roster chart and its `chart.css` were removed in Phase 5). A development-only showcase (`src/app/showcase/page.dev.tsx`) is included only by `next dev` through `pageExtensions` and is absent from the production export. Details: `docs/club-design-system.md` section 15.

## Reviewed absences — 2026-10-28

`club_snapshot_absences` stores left/missed/uncertain decisions under the immutable snapshot UUID, composite tenant FKs, SELECT-only tenant/visible-parent RLS and no direct writes. Reviewed imports use a new public invoker wrapper; legacy import callers retain their contract. Both delegate to the same locked private transaction. Baseline UUID and canonical decision IDs are checked server-side against the effective post-merge roster. Presence decisions, nickname corrections, snapshots and audits commit or roll back together; idempotency covers submitted decisions and baseline. Same-day revisions carry forward explicit departures that have not reappeared, without attributing a fresh confirmation to the actor. Deleted/old snapshots do not govern current presence.

Invoker `club_roster_presence` centralizes last observations, complete-roster evidence and explicit departures, bounded to <1,000 identities and <=200 observed rows. The Worker now needs snapshot selection + one roster RPC, no per-player network calls. Missing RPC falls back only on PGRST202 to the old read chain; authorization/other errors fail closed. `club_absence_context` reuses that read for a cutoff-safe, same-day-aware baseline. History RPC and legacy history include explicit departures; paginated seeds include departures before the page boundary. Preparing the new UI checks this schema capability before user work; it does not silently submit unsupported correction/absence metadata to an old database.

## Inline nickname correction — 2026-10-28

Optional per-row `correct_name` / `expected_name` metadata extends the existing atomic import contract. Correction requires an existing UUID, explicit identity confirmation and a matching row name; the metadata participates in request hashing but is stripped from snapshot payloads. The existing private commit rechecks membership, locks the club, rejects stale names or names/aliases owned by another player, updates only `club_players` and appends `player_renamed` audit records in the same transaction. Any later row failure rolls everything back; replay returns before mutation. No separate rename request or partial frontend write is used. Historical names and raw sources remain unchanged; ordinary imports remain compatible.

## Audited import removal — 2026-10-28

`club_snapshots.deleted_at` is a tombstone for all revisions of a date. Restrictive SELECT policies on snapshots, rows and raw imports compose with existing tenant RLS; invoker roster/history/identity reads omit removed observations without per-endpoint filtering. Player identities and explicit aliases remain. A narrow private definer transaction rechecks confirmed-user active Owner/Admin membership under the existing per-club lock, compares the current snapshot UUID, soft-deletes the date and appends audit evidence atomically. Direct table writes remain revoked. Reimports retain the hidden revision anchor but never merge hidden rows; deleted idempotency requests conflict instead of claiming success.

Existing audit writers feed `/api/activity` through an invoker RPC, 50 events per page ordered by `(created_at,id)` with a bounded extra row for continuation. An internal trigger snapshots actor email/role at mutation time; older records retain their original evidence. Logs are not cached, publicly exposed, editable or deletable. POST removal uses the existing same-origin/auth boundary and shared write cache invalidation. No service-role credentials, new dependencies or production writes are involved in local verification.

## Club B identity matching — 2026-10-27

Dependency-free `identity.ts` ranks exact formal names / explicitly confirmed aliases first, and uses Unicode decoration normalization plus bounded edit distance for suggestions only. Duplicate targets, same-name players, alias conflicts and historical anomalies require manual review. History cannot establish identity. The browser shows a summary and exceptions, supports bulk new-player confirmation, and retains an editable full preview.

Additive migration `20261027101032_club_identity_matching.sql` adds RLS-protected, auditable, revocable `club_player_aliases` and nullable per-snapshot `source_name`. Its filename matches the version assigned by the production migration API; SQL content is unchanged from the tested migration. Existing UUIDs, display names and historical snapshots remain unchanged; old raw inputs stay in imports. Invoker `club_identity_context` obtains tenant-scoped aliases, latest per-player observations and a prior roster count; bounded context rejects overflow. No broad history browsing is exposed.

The existing atomic commit independently rechecks automatic exact/alias targets under the club lock, requires explicit confirmation to remember an alias, rejects duplicate UUIDs, and records original names without overwriting formal names. Alias changes use the same confirmed-user / active Owner/Admin checks and club lock; direct table writes stay revoked. POST `/api/player-aliases` uses existing session / same-origin enforcement and server-configured club ID. Explicit correction of old mappings still creates a new daily revision; revoking an alias only affects future matching. Presence transitions remain stage C; absent players are retained and can rejoin under their original UUID.

## Real local integration testing — 2026-10-27

`test:integration` preserves all fast suites and runs real local Supabase Auth/PostgreSQL/PostgREST/Kong with the actual Club workerd/HTTPS assets. The dedicated project, ports, CLI working directory and container labels are fixed and guarded; hosted links, remote URLs, arbitrary Docker hosts and production credentials are rejected. Auth Admin creates synthetic users before unchanged business migrations are applied using CLI `migration up --local`; test-only SQL seeds two clubs and players. No application authentication or business API is mocked.

Six Playwright flows cover sessions/refresh/logout, real imports and storage, idempotency/concurrent stale revisions, Owner/Admin/unauthorized/cross-club authorization, atomic failures and offline recovery. Setup/cleanup is automatic and scoped to this project. Relevant CI changes enable this layer; simple styling does not. This supersedes the previously deferred real Auth/REST integration gap; cloud configuration, mail delivery, edge differences and non-Chromium/real networks remain outside scope.

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

## Phase 1 architecture (historical, 2026-10-26; superseded by the sections above)
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


## Club C read model — 2026-10-28

`GET /api/members` keeps the existing verified-session / active Owner/Admin guard and configured club scope. The roster adds last observed data per historical player using a bounded `club_players -> club_snapshot_players -> club_snapshots` embedding (`last.limit=1`, order by the to-one snapshot date), then compares last-seen date with the latest confirmed complete roster. The selected daily revision overrides completeness for its own day; later snapshots never affect a past view. Current snapshot values and prior-day current versions are the source of truth, with no persistence of inferred presence.

The same endpoint accepts a UUID `player` and optional cutoff `date` for the player archive. Current daily snapshots are paged in chronological order and left-embed that player's row, preserving missing complete days for departure/rejoin reconstruction. `presence.ts` owns pure state transitions and null-safe deltas. All queries include server-selected club scope and use the user's JWT with existing RLS, without a service key or schema migration. Bounds fail explicitly rather than silently truncating. See [PostgREST embedding and related ordering](https://docs.postgrest.org/en/stable/references/api/resource_embedding.html).

## Club 名称设置 — 2026-10-28
GET/POST /api/club-settings 复用现有认证、同源限制与服务端 CLUB_ID。GET 返回名称及 can_edit；POST 仅有效 Owner 可调用 migration 20261028021000_club_name_settings.sql 的 club_rename RPC。数据库再次验证邮箱与 Owner，锁定俱乐部、比较 expected_name、只更新名称并记录 club_renamed 审计；直接表写入仍禁止。前端不使用本地存储冒充持久化。此 migration 尚未应用正式库。

## Club 读取性能基础 — 2026-10-28
统一内存数据入口、实时权限门、30 秒结果 TTL／后台刷新及写后跨标签失效；Worker 输出安全分段计时，名单独立读取并行且移除未使用精确计数。个人历史分页通过 SECURITY INVOKER club_history_page RPC，100 天上限和日期游标，页边界带可信数据库上下文。详见 PERFORMANCE.md；主站认证保持独立，未增加依赖。新增 20261028040000_club_history_read.sql 尚未应用正式库。

## 成员缺席处理（2026-10-30）

导入的 left / temporary / uncertain 分别显示已确认退会／暂离／待确认，旧 missed 保持待确认；presence 仍使用 present / left / unconfirmed 分组，temporary 与 left 均进入不在会名单。暂离必须保存 1–500 字理由。共享 presenceText 决定标签，实际评分记录不补零。

新增迁移 20261030014019 扩展原有缺席记录并引入只追加的 club_absence_resolutions。POST /api/resolve-absence 经现有 Worker 身份、来源、membership 检查后调用专用 RPC；数据库再次校验 active owner/admin、当前版本、待确认状态，使用与导入相同的俱乐部事务锁，原子写处理记录和审计。重试相同选择幂等，不同选择返回冲突。历史版本不直接更新，后续同日修订保留已处理选择，重新出现的实际观察结束旧缺席状态，删除日期后忽略其选择。

准备导入时检查 absence_version=2，不兼容的数据库在开始核对前阻止提交。生产迁移仍由维护者手动应用，本次没有应用生产迁移。
