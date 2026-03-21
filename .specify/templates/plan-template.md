# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See the command workflow for execution details.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., JavaScript ES2022, Node.js 20.x or NEEDS CLARIFICATION]
**Primary Dependencies**: [e.g., Next.js 14, 23WF package, Drizzle ORM or NEEDS CLARIFICATION]
**Storage**: [if applicable, e.g., SQLite via Drizzle, or N/A]
**Testing**: [e.g., manual testing, integration tests, or NEEDS CLARIFICATION]
**Target Platform**: [e.g., Web (Next.js), Docker container, CLI or NEEDS CLARIFICATION]
**Project Type**: [single/web/agent-skill - determines source structure]
**Performance Goals**: [domain-specific, e.g., <500ms response, or NEEDS CLARIFICATION]
**Constraints**: [domain-specific, e.g., must work within 23WF job lifecycle, or NEEDS CLARIFICATION]

## Constitution Check

_GATE: Must pass before implementation. Re-check after design._

Verify against `config/SOUL.md` and `config/SPECKIT.md` principles:

| Principle | Status | Notes |
|-----------|--------|-------|
| [Principle from SOUL.md] | PASS/DEVIATION | [justification] |

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Research output (/speckit.plan command)
├── data-model.md        # Data model output (/speckit.plan command)
├── quickstart.md        # Setup/deployment guide (/speckit.plan command)
├── contracts/           # API contracts (/speckit.plan command)
└── tasks.md             # Task list (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Adjust based on where code lives in the 23WF project structure.
-->

```text
# For a new skill:
skills/<skill-name>/
├── SKILL.md
└── <script>.sh|js

# For a new team (cluster template):
config/templates/<team-id>.json

# For app changes:
app/<route>/page.js

# For package changes (in Clusters/):
Clusters/lib/<module>/
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation                  | Why Needed         | Simpler Alternative Rejected Because |
| -------------------------- | ------------------ | ------------------------------------ |
| [e.g., new dependency]     | [current need]     | [why simpler approach insufficient]  |
