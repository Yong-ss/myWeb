# Codex Working Guidelines

This is a long-term project. Keep changes simple, secure, maintainable and proportional to the task.

## Before changing code
- Inspect the relevant existing code and conventions.
- Read the relevant parts of `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`; don't assume proposals are finalized.
- If requirements are unclear or a change has significant consequences, briefly explain options and ask. Otherwise, proceed without unnecessary questions.

## While working
- Prefer small, focused changes. Reuse existing patterns; avoid premature abstractions, needless dependencies and unrelated refactors.
- Respect module boundaries and enforce access control on the server/database, not just in the UI.
- Never commit secrets or expose privileged credentials to clients.
- Do not introduce paid services, modify production data, perform destructive migrations or deploy to production without explicit approval.
- For substantial changes to authentication, database structure, deployment or shared interfaces, explain the impact before proceeding.

## After changes
- Run checks appropriate to the change (for example type checks, lint or tests). Never claim a check passed unless it ran.
- Summarize in simple Chinese: what changed, what was tested, and any remaining risks or decisions.
- When an agreed requirement or architectural decision changes, update the relevant docs; keep unconfirmed ideas clearly marked as proposals.

These guidelines are defaults, not rigid rules. Suggest better approaches when justified, and explain the tradeoffs.
