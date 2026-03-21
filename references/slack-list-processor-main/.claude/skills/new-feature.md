# /new-feature - Scaffold a New Feature Module

Scaffold a new feature module under `src/services/` with proper structure.

## Usage
```
/new-feature <feature-name>
```
Example: `/new-feature retention` or `/new-feature analytics`

## What Gets Created

### 1. Service Directory: `src/services/<feature-name>/`

Create the following files:

#### `src/services/<feature-name>/index.ts`
Main service entry point that exports the public API.

#### `src/services/<feature-name>/types.ts`
TypeScript interfaces and types for the feature.

#### `src/services/<feature-name>/<feature-name>Service.ts`
Core business logic class/functions.

### 2. Follow Existing Patterns
- Look at existing services in `src/services/` (e.g., `workflow/`, `campaign/`, `apollo/`) for conventions.
- Use Prisma for database operations.
- Use proper error handling with try/catch.
- Export a singleton or factory function as appropriate.

## Steps

1. **Ask the user** what the feature does and what its core operations are.
2. **Check for existing patterns** by reading 1-2 similar services in `src/services/`.
3. **Scaffold the files** following the established conventions.
4. **Register if needed** — add exports, register routes, or add queue workers as appropriate.

## Rules
- Always ask what the feature does before creating files.
- Follow existing service patterns in the codebase.
- Include TypeScript types for all public APIs.
- Do not create test files unless requested.
