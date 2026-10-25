# SquirrelAPI — Architecture
Updated: 2026-10-26. Phase 1 confirmed by user.

## Current architecture
- Private Monorepo Yong-ss/myWeb; actual local folder: myWeb.
- pnpm workspace, one application: apps/web.
- Next.js App Router + TypeScript + plain CSS; static export to apps/web/out.
- Cloudflare Workers Static Assets, local Wrangler preview, custom 404.
- Manual workers.dev deployment only; no domain routes, paid bindings or automatic publishing.
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
Dynamic hosting compatibility/CPU costs, auth, email, backups and cross-app sessions remain future work. Workers Free Active was confirmed from the user's subscription screenshot on 2026-10-26. The static site is deployed at https://squirrelapi-web-preview.sungshen1.workers.dev and HTTPS homepage/assets/custom 404 checks passed. Remaining account quotas and mainland China access are not verified. RM0 means staying within free limits and accepting reduced availability or disabled functions on exhaustion. No production domain binding in phase 1.
