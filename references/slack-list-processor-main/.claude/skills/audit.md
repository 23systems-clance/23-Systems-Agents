# /audit - Post-Build Audit Checklist

Run through all mandatory gates before code is considered ready to ship.

## Audit Gates (all 7 must pass)

### 1. TypeScript Build
- Run `npx tsc` in project root — must compile with zero errors.

### 2. Admin Dashboard Build
- Run `cd admin-dashboard && npm run build` — must complete with zero errors.

### 3. Admin Dashboard Lint
- Run `cd admin-dashboard && npm run lint` — must pass with zero warnings/errors.

### 4. Prisma Schema Validation
- Run `npx prisma validate` — schema must be valid.

### 5. Tests
- Run `npm test` — all tests must pass.

### 6. Git Status Review
- Run `git status` and `git diff --stat` — review all changed files.
- Flag any files that look unintentional (e.g., `.env`, `node_modules`, lock files with unexpected changes).

### 7. Security Scan
- Check for hardcoded secrets, API keys, or credentials in staged files.
- Run `git diff --cached` and scan for patterns like `sk-`, `AKIA`, `password =`, API keys, tokens.

## Output Format

Print a checklist:
```
[PASS] TypeScript Build
[PASS] Admin Dashboard Build
[PASS] Admin Dashboard Lint
[PASS] Prisma Schema Valid
[PASS] Tests Pass
[PASS] Git Status Clean
[PASS] No Hardcoded Secrets
```

Replace `[PASS]` with `[FAIL]` and describe the issue for any failing gate.
