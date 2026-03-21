# /commit - Guided Commit with Pre-Commit Checks

Create a well-structured git commit after running all pre-commit validation.

## Steps

### 1. Pre-Commit Checks
Run these in parallel:
- `npx tsc` — TypeScript must compile
- `cd admin-dashboard && npm run lint` — Lint must pass (if admin-dashboard files changed)
- `npm test` — Tests must pass

If any check fails, fix the issue before proceeding. Do NOT skip checks.

### 2. Review Changes
Run in parallel:
- `git status` — Show all changed files
- `git diff` — Show staged and unstaged changes
- `git log --oneline -5` — Show recent commits for message style reference

### 3. Stage Files
- Stage relevant files by name (not `git add .` or `git add -A`).
- Exclude `.env`, credentials, and unrelated files.
- Ask the user to confirm which files to stage if unclear.

### 4. Draft Commit Message
Format: `<type>(<scope>): <concise summary>`

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`, `perf`

Example: `feat(workflow): add template versioning and draft mode`

### 5. Confirm and Commit
- Show the proposed commit message and staged files.
- Ask for user confirmation.
- Commit using HEREDOC format for the message.

## Rules
- NEVER skip pre-commit checks.
- NEVER use `git add .` or `git add -A`.
- NEVER push — only commit locally.
- ALWAYS use `developerlabsai` GitHub account (check with `gh auth status`).
- Follow the commit message format from recent history.
