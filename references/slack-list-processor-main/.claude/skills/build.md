# /build - Build + Lint Pipeline

Run the full build and lint pipeline for both backend and admin dashboard.

## Steps

1. **Backend TypeScript build**:
   ```bash
   cd /Users/developerlabsai/Projects/SLACK\ -\ Create\ Lists && npx tsc
   ```
   - Fix any TypeScript compilation errors before proceeding.

2. **Admin Dashboard build + lint**:
   ```bash
   cd /Users/developerlabsai/Projects/SLACK\ -\ Create\ Lists/admin-dashboard && npm run lint && npm run build
   ```
   - Fix any ESLint errors before proceeding.
   - Fix any Vite/TypeScript build errors.

3. **Report results**: Summarize pass/fail for each step. If all pass, confirm the project is build-clean.

## Rules
- Do NOT skip lint even if build passes.
- Fix errors inline if they are trivial (unused imports, missing types). Ask before fixing complex issues.
- Never deploy — this skill only validates the build.
