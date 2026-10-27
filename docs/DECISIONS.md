# SquirrelAPI — Decision Log

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
