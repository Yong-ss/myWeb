# SquirrelAPI

English | [中文](README.zh-CN.md)

A roster management and analytics web app for an online game guild, plus a small personal site.

- **Club app:** [club.squirrelapi.org](https://club.squirrelapi.org) (sign-in required, see screenshots below)
- **Personal site:** [squirrelapi.org](https://squirrelapi.org)

## About

I run a game guild of about 80 players. The game only shows the member list on in-game screens, so tracking who joined, who left and who is getting stronger meant taking screenshots and keeping spreadsheets by hand.

Club turns those screenshots into a dated history. An external AI reads the screenshots into JSON. Club then matches each row to a known player, saves a daily snapshot, and shows member changes and score growth over time.

Two people use it today: me and one other guild officer. It holds the data for our ~80-member guild. I designed and built the whole project myself, using AI coding agents as development tools (rules in [AGENTS.md](AGENTS.md)).

## Screenshots

The UI is in Chinese. All screenshots use made-up demo data.

| Overview and score trend | Import: confirm player identities |
| :---: | :---: |
| ![Overview](docs/screenshots/club-overview.png) | ![Import](docs/screenshots/club-import.png) |
| **Member list** | **Player history** |
| ![Members](docs/screenshots/club-members.png) | ![Player](docs/screenshots/club-player.png) |
| **Pathway distribution** | **Audit log** |
| ![Pathways](docs/screenshots/club-pathways.png) | ![Activity](docs/screenshots/club-activity.png) |

## Highlights

- **Identity matching on import.** Nicknames are not unique and change often. Rows match by exact name first, then by confirmed aliases. Close matches (edit distance, ignoring decorative symbols) are only suggested. Uncertain rows need a human decision, and similar names are never merged automatically.
- **Versioned, traceable data.** A same-day re-import can merge or replace, but earlier versions, the raw JSON and every identity decision are kept. A player counts as having left only when they are missing from a roster confirmed as complete.
- **Authorization in the database.** One Postgres function, `can()`, makes every permission decision for both Row Level Security and the write functions. Clients cannot write tables directly. Writes go through transactional functions that recheck permissions under locks, are safe to retry, and reject stale previews using version numbers.
- **Least-privilege API.** The Cloudflare Worker uses only the publishable key plus the user's own token, keeps sessions in HttpOnly cookies, and rejects cross-origin requests.
- **MFA for the super admin.** Platform-wide access needs a TOTP session from a separately confirmed device and ends at once on logout or device removal. An append-only audit log records every change.

## Tech stack

- **Frontend:** Next.js (static export), TypeScript; Club uses Tailwind CSS v4, shadcn/ui, Radix and Motion
- **Backend:** Cloudflare Workers
- **Database and auth:** Supabase (PostgreSQL, Row Level Security, Auth with TOTP)
- **Tooling:** pnpm monorepo, Playwright, GitHub Actions

## Engineering

- **CI/CD:** every push to `main` runs only the checks affected by the change. An app is deployed only when its shipped files changed and every check passed. Docs and test changes never deploy.
- **Testing:** unit tests, Playwright browser tests, SQL tests on a disposable PostgreSQL, and integration tests against a local Supabase stack with synthetic data. No test ever touches the production database.
- **Migrations:** applied manually from the original file, then verified by checksum. Club deploys are blocked until the deployed schema version matches the newest migration.

## Roadmap

- Event records: track guild event participation over time.
- Event sign-up: let members register in advance so officers know how many will attend.

## Repository layout

```
apps/web     personal site
apps/club    Club app (frontend + Worker)
supabase/    migrations and SQL tests
tests/       unit, browser and integration tests
docs/        requirements, architecture, decisions, testing
```

Local development and testing: [docs/TESTING.md](docs/TESTING.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
