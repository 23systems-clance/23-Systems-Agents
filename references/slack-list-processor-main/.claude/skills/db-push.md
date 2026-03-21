# /db-push - Safely Review and Push Prisma Migrations

Review pending Prisma schema changes and safely push them to the database.

## Steps

### 1. Validate Schema
```bash
npx prisma validate
```
If validation fails, fix the schema before proceeding.

### 2. Show Pending Changes
- Read `prisma/schema.prisma` and compare against the current database state.
- Run `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma` to show what will change.
- Clearly list: new tables, altered columns, dropped columns/tables, new indexes.

### 3. Risk Assessment
Flag any destructive operations:
- Column drops or renames (data loss risk)
- Type changes on existing columns
- Dropping tables
- Removing required fields without defaults

### 4. Confirm with User
Present the summary and ask for explicit confirmation before proceeding.

### 5. Push Migration
After user confirms:
```bash
npx prisma db push
```

### 6. Regenerate Client
```bash
npx prisma generate
```

## Rules
- NEVER push without showing the diff first.
- NEVER push destructive changes without explicit user approval.
- Always regenerate the Prisma client after a successful push.
