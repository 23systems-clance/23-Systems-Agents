# UI/UX Review: [SCREEN_NAME]

**Feature**: [FEATURE_NAME]
**Reviewer**: [REVIEWER]
**Date**: [DATE]
**Status**: Draft | In Review | Approved

---

## Screen Overview

**Purpose**: [What user goal does this screen serve?]

**User Story**: As a [ROLE], I need to [ACTION] so that [BENEFIT].

**Entry Points**: [How does the user get to this screen?]

**Exit Points**: [Where can the user go from here?]

---

## Component Hierarchy

```
[SCREEN_NAME]
├── Header
│   ├── PageTitle
│   └── ActionButtons
├── Filters (if applicable)
│   ├── SearchInput
│   └── FilterDropdowns
├── MainContent
│   ├── [PRIMARY_COMPONENT]
│   └── [SECONDARY_COMPONENTS]
└── Footer (if applicable)
    └── Pagination / Actions
```

---

## Components Used

| Component | Usage             | Props/Variants       |
| --------- | ----------------- | -------------------- |
| Button    | Primary action    | variant="default"    |
| DataTable | Main content      | sortable, filterable |
| Dialog    | Create/Edit modal | -                    |
| ...       | ...               | ...                  |

---

## Accessibility Audit

| Criterion                   | Status    | Notes                           |
| --------------------------- | --------- | ------------------------------- |
| Color Contrast (4.5:1 text) | Pass/Fail |                                 |
| Color Contrast (3:1 UI)     | Pass/Fail |                                 |
| Keyboard Navigation         | Pass/Fail |                                 |
| Focus Indicators            | Pass/Fail |                                 |
| Screen Reader Labels        | Pass/Fail |                                 |
| Touch Targets (44x44px)     | Pass/Fail |                                 |
| Motion Preferences          | Pass/Fail | respects prefers-reduced-motion |

---

## State Definitions

### Loading State

- [ ] Skeleton components for content areas
- [ ] Disabled interactions during load
- [ ] Progress indicator for long operations

### Empty State

- [ ] Helpful message explaining why empty
- [ ] Clear call-to-action to populate
- [ ] Illustration (optional)

**Message**: "[EMPTY_STATE_MESSAGE]"

**CTA**: "[BUTTON_TEXT]" -> [ACTION]

### Error State

- [ ] Clear error message
- [ ] Recovery action available
- [ ] Non-blocking where possible (toast vs inline)

### Success State

- [ ] Confirmation feedback
- [ ] Next step guidance (optional)
- [ ] Auto-dismiss timing

---

## Responsive Breakpoints

| Breakpoint  | Layout Changes |
| ----------- | -------------- |
| sm (640px)  | [CHANGES]      |
| md (768px)  | [CHANGES]      |
| lg (1024px) | [CHANGES]      |
| xl (1280px) | [CHANGES]      |

---

## Implementation Notes

[Any specific implementation details, patterns, or constraints]

---

## Sign-Off

- [ ] Review completed
- [ ] All Critical issues resolved
- [ ] Accessibility audit passed
- [ ] Responsive design verified
- [ ] Ready for implementation

**Approved By**: [NAME]
**Date**: [DATE]
