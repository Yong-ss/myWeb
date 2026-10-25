# SquirrelAPI — Architecture (Draft v0.1)
Date: 2026-10-26. Technology choices remain subject to proof-of-concept validation.

## Goals
Manage multiple independently developable applications in one private GitHub Monorepo. Share foundational services where appropriate, while keeping clear boundaries and minimizing maintenance and cost.

## Agreed direction
- Repository: Yong-ss/myWeb (private), local root folder 'my web'.
- Monorepo organization, new apps primarily developed by Codex.
- Domain: squirrelapi.org, managed in Cloudflare; paths and subdomains can route to different apps.
- Data: prefer one Supabase project initially, with logical data separation and enforced permissions.
- Identity: shared Supabase Auth by default; allow special future apps to use their own identity design.
- Admin Console: manage registration policy, user permissions and app availability through configuration.

## Candidate stack (not final)
- Next.js + TypeScript for web apps.
- Cloudflare Workers free tier for suitable deployments; validate compatibility and limits first.
- Supabase Free for PostgreSQL, authentication and storage.
- GitHub Actions for CI within available free quota.
Workers may not suit all Node.js dependencies, long-running jobs or GPU workloads.

## Proposed structure (illustrative, create only when needed)
```text
my web/
  apps/
    web/
    admin/
    tools/
  packages/
    auth/
    ui/
    config/
  docs/
    REQUIREMENTS.md
    ARCHITECTURE.md
    DECISIONS.md
  AGENTS.md
```

## Engineering principles
- Admin configuration governs business policy, not database schemas or core security guarantees.
- Enforce authorization on server and through appropriate Supabase RLS and least privilege.
- Shared database does not imply unrestricted cross-app data access.
- Separate deployments require explicit CI/deployment setup; Monorepo alone does not provide isolation.
- Keep local/test and production data separate. Prefer local testing where free-plan project limits apply.
- Cross-subdomain single sign-on needs deliberate session, cookie or OAuth design.
- China access and performance must be tested on actual networks.

## Open architecture decisions
Hosting compatibility, routing, database schema boundaries, app registration contract, secrets and environments, deployment approval, monitoring, backups and recovery.
