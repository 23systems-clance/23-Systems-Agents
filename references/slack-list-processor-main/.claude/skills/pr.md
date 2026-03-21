# /pr - Create a GitHub PR with Structured Description

Create a well-structured GitHub Pull Request.

## Steps

### 1. Pre-Flight Checks
Run in parallel:
- `gh auth status` — Verify `developerlabsai` account is active. If not, run `gh auth switch --user developerlabsai`.
- `git status` — Check for uncommitted changes.
- `git log --oneline main..HEAD` — List all commits in this branch.
- `git diff main...HEAD --stat` — Show all files changed vs main.

### 2. Analyze Changes
- Review all commits since branching from main (not just the latest).
- Categorize changes: new features, bug fixes, refactoring, etc.
- Identify affected areas: backend, admin dashboard, database, infra.

### 3. Draft PR
- **Title**: Short, under 70 characters, following conventional format.
- **Body**: Use this template:

```markdown
## Summary
- <1-3 bullet points describing what changed and why>

## Changes
- <Categorized list of significant changes>

## Test plan
- [ ] <Testing steps>

Generated with [Claude Code](https://claude.com/claude-code)
```

### 4. Confirm with User
Show the draft title and body. Ask for approval before creating.

### 5. Create PR
```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
<body>
EOF
)"
```

### 6. Push if Needed
- If the branch hasn't been pushed yet, push with `-u` flag first.
- Confirm before pushing.

## Rules
- ALWAYS verify `developerlabsai` account first.
- NEVER self-approve or merge the PR.
- Show the draft and get confirmation before creating.
- Base branch defaults to `main` unless the user specifies otherwise.
