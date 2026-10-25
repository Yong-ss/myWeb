# SquirrelAPI — Decision Log
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
