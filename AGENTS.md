# Codex Guidelines — SquirrelAPI

This repository is a long-term, extensible personal platform. Optimize for reliability, clarity, security and zero additional monthly cost; avoid unnecessary complexity.

## Working rules
1. Read docs/REQUIREMENTS.md, docs/ARCHITECTURE.md and docs/DECISIONS.md before relevant changes.
2. Inspect existing code first. Follow established conventions; don't replace frameworks or introduce paid services without approval.
3. Small changes may proceed directly. For authentication, authorization, database migrations, cross-app interfaces, deployment or major refactors, briefly explain tradeoffs and ask before disruptive changes.
4. Keep app boundaries clear. Share only stable, genuinely reusable code; avoid speculative abstractions.
5. Enforce permissions server-side and in database policies. Never expose privileged Supabase keys in client code or commit secrets.
6. Run relevant type checks, lint and tests. State clearly what passed, failed or could not run; never claim unperformed tests passed.
7. Do not change production data, execute destructive migrations or deploy to production without explicit authorization.
8. After each task, summarize in simple Chinese what changed, affected apps, data flow, verification and remaining risks.
9. Suggest updates to requirement, architecture and decision docs when decisions change. Never promote proposals to confirmed decisions.
10. These are guiding principles, not rigid constraints. Propose better alternatives with clear reasons when appropriate.

## Current constraints
- Extra monthly budget: RM0 (domain already purchased).
- GitHub private Monorepo, Cloudflare and Supabase Free are preferred starting points, subject to validation.
- New apps are coded by Codex and integrated through documented interfaces, not installed via a plugin marketplace.
