# SquirrelAPI — Requirements (Draft v0.1)

## Club stage B continuation — 2026-10-27
The owner instructed continuation after stage A. Stage B adds the approved JSON import/preview/human-confirmation/versioned transaction workflow. C (member/history browsing), D (analysis) and E (invitations/management) remain deferred; detailed implementation semantics and limits are recorded in CLUB_REQUIREMENTS.md.

## Club implementation authorization — 2026-10-27
The owner approved the architecture and Club stage A implementation/deployment. `docs/CLUB_REQUIREMENTS.md` records the scope: independent app and Worker, existing Supabase Auth with isolated sessions, database constraints/RLS, only the owner's first club. A–C remain the first-version target; B/C are not part of this delivery, and D/E are deferred. Main-site authentication is unchanged. Direct deployment to `club.squirrelapi.org` after checks is authorized; no paid services.

## Deployment workflow update — 2026-10-27
The owner confirmed preview login/session/logout works and authorized production rollout. While only the owner uses the site, ordinary updates can publish directly to the main domain after appropriate checks, without mandatory preview deployment. This supersedes the preview-first requirement below; RM0 and minimal feature scope remain.

## Confirmed phase 2 scope — 2026-10-27
Only the owner currently uses the site, with email/password. Add login, session continuity and logout; no first business feature, Admin, invitation UI or business tables. Use the existing myWeb's Project. Public signup is disabled; server access requires the configured confirmed owner ID. Validate preview before a separately approved production release. This supersedes phase 1's no-auth/backend restriction only.

Date: 2026-10-26. Status: evolving draft, not final specification.

## Vision
Build an extensible platform under squirrelapi.org with private features, public pages and apps for invited friends. Codex will primarily implement new features.

## Confirmed requirements
- R-01: Support public, authenticated and restricted-access pages and tools.
- R-02: Admin Console manages users, app visibility and access permissions.
- R-03: Registration policy can be configured: public, invitation-only or disabled. Enforcement must happen server-side.
- R-04: Default shared platform identity; special future apps may have independent identity systems. Do not build two identity systems now.
- R-05: Codex develops and integrates apps; no requirement for an admin-side plugin installer.
- R-06: Platform may include websites, APIs, AI tools and automations.
- R-07: Use existing private GitHub repo myWeb (local folder: my web).
- R-08: No additional monthly spend beyond the already purchased domain; stay within free service limits.
- R-09: Friends in mainland China and elsewhere may use services; test real-world accessibility rather than assuming it works.

## Proposed authorization model (not finalized)
Visitors can view public content; signed-in users access permitted apps; invitations grant defined access; platform admin manages users and settings. Invitation status should not automatically imply a permanent role.

## Acceptance criteria to refine
- Registration behavior changes according to the admin-configured policy.
- Disabling an app denies unauthorized backend requests, not merely hides its navigation entry.
- Users cannot read protected data belonging to other users or apps.
- An app appears in Admin Console only after Codex implements its integration contract.

## Open questions
Initial feature scope; UI and language support; login providers and invitation flow; permission granularity; audit logs and backups; China access benchmarks; production approval and testing workflow.

## Confirmed phase 1 scope — 2026-10-26
- pnpm Monorepo with one Next.js + TypeScript static homepage, Chinese content, navigation and empty app collection.
- Local lint, type checking, static build and Cloudflare preview/deployment configuration.
- Run/deployment instructions and updated architectural decisions.
- No login, Admin, database, backend, other apps, paid services or formal domain binding.
- Acceptance: lockfile install, local build, homepage/navigation/404 work in Cloudflare local preview; cloud deployment remains manual.
- This resolves the initial feature scope question above; future feature details remain open.

## Scope update — 2026-10-26
The user subsequently authorized binding the root domain squirrelapi.org. Production and preview deploy independently from the same application. This supersedes the initial restriction on formal domain binding; all other scope limits remain.
