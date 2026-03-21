# [DOMAIN] Requirements Quality Checklist: [FEATURE NAME]

**Purpose**: Validate [domain] requirements completeness and quality before implementation
**Created**: [DATE]
**Feature**: [Link to spec.md]
**Domain**: [ux/api/security/performance/etc.]

## Requirement Completeness

- [ ] CHK001 - Are all necessary [domain] requirements documented? [Completeness]
- [ ] CHK002 - Are [domain]-specific edge cases identified? [Coverage]
- [ ] CHK003 - Are error/failure scenarios for [domain] defined? [Coverage, Exception Flow]

## Requirement Clarity

- [ ] CHK004 - Are [domain] requirements unambiguous and specific? [Clarity]
- [ ] CHK005 - Are vague terms quantified with measurable criteria? [Clarity]
- [ ] CHK006 - Can each requirement be objectively verified? [Measurability]

## Requirement Consistency

- [ ] CHK007 - Do [domain] requirements align across all sections? [Consistency]
- [ ] CHK008 - Are there any conflicting [domain] requirements? [Conflict]
- [ ] CHK009 - Is terminology used consistently throughout? [Consistency]

## Acceptance Criteria Quality

- [ ] CHK010 - Are success criteria measurable and technology-agnostic? [Acceptance Criteria]
- [ ] CHK011 - Can acceptance criteria be verified without implementation details? [Measurability]

## Scenario Coverage

- [ ] CHK012 - Are all primary user flows addressed? [Coverage]
- [ ] CHK013 - Are alternate flows documented? [Coverage, Alternate Flow]
- [ ] CHK014 - Are recovery/fallback scenarios defined? [Coverage, Recovery Flow]

## Dependencies & Assumptions

- [ ] CHK015 - Are external dependencies documented? [Dependency]
- [ ] CHK016 - Are assumptions explicitly stated? [Assumption]
- [ ] CHK017 - Are integration points clearly defined? [Integration]

## Notes

- Items marked incomplete require spec updates before proceeding to `/speckit.plan`
- Reference spec sections with `[Spec §X.Y]` notation
- Use markers: `[Gap]`, `[Ambiguity]`, `[Conflict]`, `[Assumption]` for issues found
