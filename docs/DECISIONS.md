# SquirrelAPI — Decision Log

## Highland Race V1: engineering choices — 2026-11-05

The business rules are those confirmed in `docs/CLUB_HIGHLAND_RACE_DISCUSSION.md`. Choices made during implementation where the document left room:
- Shared `club_events` and versions, separate metric table (`club_highland_event_players`); the type is enforced by the database (composite foreign key with a constant type, a trigger on the Four-Way League tables, an immutable `event_type`), not only by the functions.
- Faction names: only 「血皇帝势力」 is confirmed (seen in the 2026-11-04 screenshots). The database list (`club_private.highland_factions()`) and the page list hold only that name; the other three are added by a later migration when the owner provides them. Rank 1-4 works independently.
- Automatic proposal: only an exact name or confirmed alias of a player in the **latest valid roster**. The same name of a departed player, similar names, two players with one name, and a repeated name with different values wait for a person. Rows with no relation to any player are proposed for exclusion (one click per row is never required for them; they stay searchable and can be included). Two-character names one character apart are not flagged as similar (too common on a faction board) unless only symbols differ.
- No new player identity from a highland import or edit: a faction board name without a match is not evidence of a new member. Departed players stay selectable (history link).
- No raw JSON is stored for highland (the original contains other clubs' players). Stored instead: each participant's read names, all metrics, the full state per version, and the counts the browser reports (`reported_source`), labelled as reported, not verified.
- The administrator confirms the final roster with an explicit checkbox in the save dialog (names listed, departed members marked).

## Four-Way League V1: engineering choices — 2026-11-04

The business rules are those confirmed in `docs/CLUB_EVENTS_DISCUSSION.md`. Choices made during implementation where the document left room:
- Platform-admin settings are tri-state (allow / deny / follow); personal beats club role; both sit below the Super Admin cap and forced setting and above the owner's settings. "Follow" removes the row, so the next lower layer applies at once.
- A new player created in an event import must not have the exact name (or a confirmed alias) of an existing player of the club; the operator picks the existing player instead.
- An absence needs positive evidence (see ARCHITECTURE.md); an event after the latest roster is "uncertain" until a later roster exists. Temporary leave, unresolved rosters, departures and dates before the first record never count.
- Identical repeated rows in one table (the pinned own row) are merged automatically and the count is shown; the same name with different values is kept for manual review.
- The raw AI JSON is visible only to direct club readers in the event detail; there is no separate export.


## Permissions V1: owner grants to admins, plan A — 2026-11-03 (final)

- Owner-confirmed plan A. When an owner widens admins (`club_set_admin_default` / `club_set_admin_permission`: explicit allow, or "follow" that ends in allow), the caller must be this club's active owner and hold the permission through the owner role itself (`club_private.caller_owner_holds`). An alliance-leader read or any other identity never counts. The active Super Admin keeps the previous behaviour on these writers and on every platform writer.
- Checked only when written. `permission_layer()` is unchanged: a later Super Admin tightening of the owner does not revoke earlier admin grants. To take them back, the Super Admin uses the admin role cap or a forced personal deny (both win over owner settings). Accepted product rule, not an open risk.
- Rejected plan B (owner grants continuously bounded by the current owner): needed source tracking on club defaults, history backfill and an extra layer in every check, for a rare case the cap and forced deny already cover.

## Permissions V1 stage A: single role per club — 2026-11-02

- Owner-confirmed spec (docs/CLUB_PERMISSIONS_PLAN.md). One active role per user per club (partial unique index); history rows kept. **Supersedes D-036's multi-role union** and the P4 notes below on preserving other roles during transfer.
- Existing owner+admin doubles: keep owner, revoke the extra role in the migration (audited). Any other double stops the migration.
- Transfer: new `platform_transfer_owner` requires choosing the previous owner's outcome (admin / leave); successor's admin role is released in the same transaction; admin limit applies; all-or-nothing. The legacy `platform_assign_role` transfer keeps its signature and means "previous owner leaves".
- `platform_remove_from_club` revokes all roles in one club, refused for the owner. `platform_set_admin_limit` (new `platform.clubs.admin_limit`, Super Admin only) never goes below the current admin count.

## P4 role assignments — 2026-10-31

- Owner request: existing verified website accounts only, explicit target club, owner/admin roles, Super Admin trusted MFA in Worker and database. Owner cannot manage assignments in P4 despite the earlier requirements proposal.
- (Superseded by Permissions V1 stage A: single role, explicit transfer outcome, admin limit editable by the Super Admin.) Preserve the multiple-role primary key and unique active owner index. Transfer revokes only the old owner role, preserves all other roles and does not grant admin automatically; never revoke an active owner independently.
- Default administrator cap is 5 active holders per club, stored as configuration for later changes; no cap editing UI or automatic cleanup of legacy excess.
- Atomic locked RPC with optimistic club revision and actor/request idempotency; reuse P3 platform audit triggers. No custom role/permission/override editing. Local-only implementation validated by SQL, unit, browser, real Supabase integration and old-Worker compatibility tests; pending owner acceptance and separate production approval.


## Club authorization and Admin Panel — 2026-10-30

- D-033 Confirmed (owner): RBAC + scope + per-user exceptions, delivered in phases P1–P8. Default deny, deny wins, revocation takes effect immediately, checks in both Worker and database, append-only audit. One permission registry; roles are permission sets bound to a scope (platform / alliance / club). Delegation is separate from holding a permission. Alliance roles are read-only; writes are granted per club. A club belongs to at most one alliance.
- D-034 Confirmed: the owner is the only Super Admin. The identity lives in `platform_super_admins`, which no client role, assignment or override can change. The Super Admin has full authority over every club, alliance and future feature, active only with TOTP MFA (`aal2`) enforced in the database. Without MFA the account keeps only its ordinary memberships, so it cannot lock itself out. The Super Admin can move a club between alliances directly (audited, Leader notified); ordinary joins need Leader consent.
- D-035 Confirmed: audit identity privacy. Nobody but the MFA-verified Super Admin sees the Super Admin's email or user ID; other viewers see the public name (default 「超级管理员」). By default no role sees any actor email (`audit.actor_email.read` must be granted). The real `actor_id` is always stored; rows are never rewritten. Historical rows are masked when read.
- D-036 Implemented (P2, local; the multi-role union is superseded by Permissions V1 stage A, 2026-11-02): writes, business RLS and Worker routes use registry permissions only; multiple club roles per user (union); Super Admin TOTP via Supabase Auth with aal2 enforced in the database. First activation of each authenticator also needs the owner to confirm it in Supabase SQL Editor (`club_private.trust_super_admin_factor`), because a stolen password alone can bind a new TOTP. Recovery: keep at least two confirmed authenticators; if all are lost, the owner deletes the factors in Supabase (Authentication → Users → the account → MFA factors, or SQL Editor), re-enrolls and confirms again. An unrecognised authenticator: do not confirm it; delete it and change the password. The account still signs in as the club owner meanwhile.
- D-037 Implemented (P3, local): platform panel is read-only. `platform.read` (platform scope) gates it; only the active Super Admin holds it until P7 adds platform roles, which must then also mask the Super Admin in platform readers. Platform-level changes, including SQL Editor ones, go to an append-only platform log by table trigger. Assigning roles stays for P4, editing roles and permissions for P7.
- **Supersedes:** D-023's "no automatic Super Admin access to other clubs' business data", D-026's "no Super Admin business-data bypass" and D-025's implementation note that platform administration cannot bypass business RLS. Super Admin access goes through `can()` in the database, still without any privileged key (Workers keep the publishable key). Takes effect for business data in P2; P1 adds the core without changing business access.

## CI deploy correctness — 2026-10-29

- D-032 Confirmed (owner request): keep direct push to `main` with automatic deploy; no PR, branch protection or rulesets.
- Deploy scope is separate from test scope: only files that change a shipped bundle deploy (`apps/<app>/**` except Markdown and `*.test.mjs`; dependencies/unknown paths deploy both). Tests, scripts, CI, migrations and docs never deploy.
- The diff base is the last successful main run, `main` runs no longer cancel each other, and a run whose commit is no longer `main` HEAD refuses to deploy. Supersedes the cancel-in-progress behaviour and the `github.event.before` diff base under D-031.

## Automatic production delivery — 2026-10-27

- D-031 Confirmed: user requested GitHub Actions to deploy automatically after tests pass, superseding the manual-only publishing policy for main-branch application changes.
- Extend the existing job without another install/build or service: successful `push` to `main` deploys only affected apps, using the exact built assets from that run. PRs, tags, manual test runs, failed/cancelled checks and documentation-only changes do not deploy.
- Use repository Secret `CLOUDFLARE_API_TOKEN` and Variable `CLOUDFLARE_ACCOUNT_ID`; credentials are supplied only to main-branch deployment steps. No OAuth refresh token, database admin credential or secret is stored in source.
- Production SQL remains manual. Club deployment requires repository Variable `CLUB_SCHEMA_VERSION` to match the latest migration filename, and maintainers update this marker only after applying that migration successfully. At the time of D-031 the verified production version was `20261027101032`; the current value lives only in the repository Variable. Pending schema changes therefore stop the release rather than silently deploying an incompatible client.

## Club B identity matching — 2026-10-27

- D-030 Confirmed: user authorized first-time bulk identity confirmation, subsequent unique exact/confirmed-alias auto matching, explicit ambiguous/new-player decisions, revocable aliases and anomaly warnings; no ML/API fees or stage C expansion.
- Keep permanent UUIDs and immutable history. Add original nickname and a tenant-scoped alias ledger; never infer confirmed aliases from raw imports or overwrite the formal nickname. Allow alias duplicates across people so conflicts are visible and block auto matching rather than forcing a false global uniqueness assumption.
- Reuse existing atomic import, RLS, Auth, Node/SQL/Playwright/real local Supabase suites. Validate automatic targets again in the transaction to catch concurrent alias changes. User authorized additive production migration and direct Club deployment after necessary regression passes; main site and Auth configuration remain unchanged.
- Release verified: [CI for implementation 3753f45](https://github.com/Yong-ss/myWeb/actions/runs/40485846645) passed; local verification passed 40 Node tests, 3 SQL suites, 4 fast browser flows and 9 real Supabase flows. Applied production migration `20261027101032` (repository filename aligned with the API-assigned history version, identical tested SQL) and deployed `squirrelapi-club` version `4fb23329-2110-4eee-b661-d36069b92dfa`. Read-only smoke verified public pages, unauthenticated API denial and the exact uploaded identity bundle. No production fixture/login/import test was run; business table counts were unchanged. Security advisors reported only the pre-existing [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); Auth settings were not changed.

## Real integration testing — 2026-10-27

- D-029 Confirmed: owner authorized real isolated local Supabase/Worker/Playwright integration before stage C, retaining all fast suites, no production writes/deployment/paid services.
- Implementation: reuse CLI 2.120.0 and Docker, fixed project/ports, actual Auth-created synthetic users followed by unchanged local migrations. Only the four required backend services run; no hosted project link or production runtime configuration is used.
- Login/database/critical-flow changes and full regressions run the real layer; ordinary styling uses fast tests. Failure artifacts include scrubbed local diagnostics. Normal completion or failure removes the dedicated test stack/data; no other project is stopped.

## Automated testing — 2026-10-27

- D-027 Confirmed: owner requested testing infrastructure before C/D/E, with existing Node.js/SQL/club:check preserved, targeted CI, modest Playwright coverage, no production test writes, no deployment or paid services.
- D-028 Implementation: use a disposable CI PostgreSQL 17 service and guarded SQL runner; browser API mocks plus existing Worker tests avoid real accounts and production traffic. Full Supabase Auth/REST/browser integration remains deferred until a complete isolated stack exists.
- C/D/E must add valuable tests, run related checks routinely, regress at important stage/release checkpoints and run the complete suite after A–E. Computer Use is reserved for visual or automation gaps; no forced TDD or coverage percentage.

## Club import implementation — 2026-10-27

- D-026 Confirmed: user instructed continuation after stage A delivery; implement B only, keeping C/D/E deferred. Follow the existing owner-only direct-production workflow after appropriate checks.
- Implementation: freeze v1 field contract; always require explicit identity selections. Support same-day merge/replacement with a final preview, default incomplete roster, immutable prior metric rows, retry idempotency and expected-version conflict handling.
- Implementation: confirmed null replaces the submitted player's old field; merge retains only unsubmitted players from that day's current version. Limits are 128 KiB raw input, 200 final rows, and 1000 identity candidates, with explicit over-limit errors.
- Security: privileged transaction helper is private and narrowly executable; its public wrapper is invoker. Membership checks live inside the transaction too; no direct client DML or Super Admin business-data bypass.

## Club safety foundation — 2026-10-27

- D-022 Confirmed: independent `apps/club` and Worker, existing Supabase project/Auth, isolated host-only sessions; main-site login remains unchanged.
- D-023 Confirmed: revision history for same-day corrections, explicit human identity confirmation, no automatic Super Admin access to other clubs' business data.
- D-024 Confirmed: initial delivery target A–C, but only stage A authorized now; stages B/C need a follow-up instruction and D/E remain deferred. First club only; no invitation system.
- D-025 Confirmed: after local checks, direct deployment to `club.squirrelapi.org` is authorized for this delivery; RM0, no paid service or automatic deployment.
- Implementation: no client business writes in stage A. Use active per-club membership for SELECT RLS, composite tenant foreign keys, explicit owner bootstrap and no privileged browser/server runtime key. Management APIs are deferred, so platform administration cannot bypass business RLS.

## Direct production updates — 2026-10-27
- D-021 Confirmed: user verified preview login, session persistence and logout, and authorized rollout to squirrelapi.org.
- While the owner is the only user, routine changes may deploy directly to production after appropriate checks; supersedes D-020's mandatory preview-first workflow. Keep preview available but optional. Paid services, destructive changes and material new access still require separate authorization.

## Owner login — 2026-10-27
- D-018 Confirmed: owner-only email/password login using the existing myWeb's Project, no business features yet; supersedes D-015 for minimal authentication only.
- D-019 Implementation: static Next.js plus a small Cloudflare Worker Auth API, no full Next.js server adapter or additional dependency. Store tokens in HttpOnly host-only cookies and enforce owner ID on the server.
- D-020 Preview first: use the existing free Supabase project, disable signup while preserving global email confirmation; production rollout and password recovery verification are still pending. No business tables, Admin or cross-subdomain session framework.

Updated: 2026-10-26.

| ID | Status | Decision | Rationale / constraint |
|---|---|---|---|
| D-001 | Confirmed | Long-term personal platform with private and public functions | Extensibility |
| D-002 | Confirmed | Use existing squirrelapi.org domain | Already purchased |
| D-003 | Confirmed | One private GitHub repo Yong-ss/myWeb | Already created |
| D-004 | Confirmed | Organize code as Monorepo | Manage multiple apps together |
| D-005 | Confirmed | Codex implements new apps | No dynamic plugin installer for now |
| D-006 | Confirmed | RM0 additional monthly budget | Use free tiers |
| D-007 | Confirmed | Admin Console configures registration and app permissions | Avoid hardcoded business policy |
| D-008 | Confirmed | Shared login by default; special future apps may use independent identity | Do not implement second identity now |
| D-009 | Confirmed | No current requirement for full database/server independence per app | Avoid overengineering |
| D-010 | Preferred | One Supabase project with logical app data isolation | Simplify operations; validate limits/RLS |
| D-011 | Candidate | Next.js + TypeScript | Deployment fit not yet validated |
| D-012 | Candidate | Cloudflare Workers hosting | Validate free tier and compatibility |
| D-013 | Open | Automatic production deployment vs manual approval | Not decided |

## Decision hygiene
For new decisions, record date, reason, scope and status. Never mark undecided matters confirmed. Preserve history and rationale when superseding decisions.

## Phase 1 confirmation — 2026-10-26
The user accepted the static-first proposal and authorized implementation.
- D-011 is now Confirmed: Next.js + TypeScript, static export; supersedes Candidate status above.
- D-012 is now Confirmed for static assets on Cloudflare Workers; dynamic hosting remains unvalidated.
- D-014 Confirmed: pnpm workspace with apps/web only; no Turborepo/Nx or empty shared modules.
- D-015 Confirmed: no login, Admin, database or backend in phase 1.
- D-016 Confirmed: local checks, manual workers.dev deployment instructions, no paid services/domain binding. D-013 stays open for future production publishing.
- Implementation choice: ESLint 9.39.5 temporarily retained because bundled React/import/accessibility plugins do not declare ESLint 10 support; migration deferred until compatible.

## Root domain authorization — 2026-10-26
- D-017 Confirmed: user explicitly authorized binding squirrelapi.org; supersedes the domain restriction in D-016 and the initial phase 1 scope.
- Separate production Worker squirrelapi-web from squirrelapi-web-preview using the same static app and a dedicated Wrangler configuration; no new application or dependencies.
- Publish manually with deploy:production; preview publishing does not update production. No www binding, paid upgrade or Supabase project. Keep noindex until indexing is separately decided.

## Club 唯一视觉基准 — 2026-10-27（已确认）
用户确定 Dark Victorian Occult Dashboard 为 Club 长期唯一设计语言；以 docs/club-design-system.md、仓库保存的原始参考稿和统一 Tokens 为依据。当前先建立规范和持久指令，不立即重做页面；后续渐进迁移，不改变业务／权限／数据库，不修改 apps/web。此前正式发布授权不用于此次改版，部署须另获授权。

## Club phase 2: account context — 2026-11-02

- Owner request: sign-in and identity must not depend on the fixed `CLUB_ID`; keep authentication, platform authorization, club authorization and club context separate. Local only; production migration, commit and deploy need separate approval.
- Add read-only `public.club_my_context()` (caller only, own active memberships only, no parameters) instead of N per-club calls; reuse `can()`, `can_platform()` and `super_admin_active()`. Club requests keep `club_my_access(CLUB_ID)`. Accounts with a role only in another club may sign in and see it as not yet available. Details in `CLUB_ARCHITECTURE.md` §8.
- D-038（2026-11-02，阶段 F，owner 确认）：联盟由超级管理员和平台管理员（需 TOTP）直接新建／停用并安排俱乐部；公会长也可申请加入，由该联盟会长批准（实现 D-034 的「普通加入需要会长同意」）。每联盟一位会长、每人一个联盟。联盟会长只读，看不到原始导入 JSON 和账户邮箱。详情见 `docs/CLUB_PERMISSIONS_PLAN.md` §2 第 10 条与 §6 阶段 F 记录。
- D-039（2026-11-03，阶段 G，owner 确认）：只有超级管理员可以把账户移出全部俱乐部；该账户仍是任何俱乐部的公会长时整体拒绝，须先转让（不跳过、不部分成功、不自动转让）。只撤销俱乐部职位，账户、平台／联盟身份、个人设置、历史与审计保留。详见 `docs/CLUB_PERMISSIONS_PLAN.md` §2 第 11 条、§6 阶段 G 与 §7 上线方案。
