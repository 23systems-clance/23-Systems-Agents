# /design - Architecture Design Before Implementation

Design the architecture (data model, API contracts, components) for a feature before writing any code.

## Usage
```
/design <feature-description>
```
Example: `/design workflow template versioning` or `/design campaign analytics dashboard`

## Steps

### 1. Understand Requirements
- Ask clarifying questions about the feature scope and goals.
- Identify constraints (existing models, API patterns, UI conventions).

### 2. Research Existing Patterns
- Read relevant existing code in `src/services/`, `src/routes/admin/`, `prisma/schema.prisma`.
- Check `admin-dashboard/src/pages/` and `admin-dashboard/src/services/` for frontend patterns.
- Identify what can be reused vs what needs to be new.

### 3. Design Artifacts

Produce these sections:

#### Data Model
- New Prisma models or changes to existing ones.
- Show the schema additions in Prisma format.
- Call out relationships, indexes, and enums.

#### API Contracts
- List all new endpoints: method, path, request body, response shape.
- Use Zod-style type definitions for request/response.
- Note which endpoints are admin-only.

#### Frontend Components (if applicable)
- Page layout and key components needed.
- State management approach (React Query keys, local state).
- Navigation changes (sidebar, routes).

#### Queue/Worker Design (if applicable)
- BullMQ queue names and job data shapes.
- Worker processing logic outline.
- Error handling and retry strategy.

### 4. Present for Review
- Output the design as a structured document.
- Ask for feedback before proceeding to implementation.

## Rules
- NEVER write implementation code — design only.
- Always check existing patterns before proposing new ones.
- Keep designs consistent with the project's established conventions.
- Flag any breaking changes or migration requirements.
