# UI/UX Review: [SCREEN_NAME]

**Feature**: [FEATURE_NAME]
**Reviewer**: Gemini CLI + [HUMAN_REVIEWER]
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

## shadcn/ui Components Used

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

**Implementation**: `<Skeleton className="..." />`

### Empty State

- [ ] Helpful message explaining why empty
- [ ] Clear call-to-action to populate
- [ ] Illustration (optional)

**Message**: "[EMPTY_STATE_MESSAGE]"

**CTA**: "[BUTTON_TEXT]" → [ACTION]

### Error State

- [ ] Clear error message
- [ ] Recovery action available
- [ ] Non-blocking where possible (toast vs inline)

**Validation Errors**: Inline below fields
**API Errors**: Toast notification with retry option

### Success State

- [ ] Confirmation feedback
- [ ] Next step guidance (optional)
- [ ] Auto-dismiss timing

**Implementation**: Toast with 5s auto-dismiss

---

## Responsive Breakpoints

| Breakpoint  | Layout Changes |
| ----------- | -------------- |
| sm (640px)  | [CHANGES]      |
| md (768px)  | [CHANGES]      |
| lg (1024px) | [CHANGES]      |
| xl (1280px) | [CHANGES]      |

---

## Gemini CLI Feedback Summary

### Overall Assessment

[1-2 sentence summary from Gemini review]

### Strengths

- [STRENGTH_1]
- [STRENGTH_2]

### Issues Addressed

| Issue     | Severity | Resolution     |
| --------- | -------- | -------------- |
| [ISSUE_1] | Critical | [HOW_RESOLVED] |
| [ISSUE_2] | Major    | [HOW_RESOLVED] |
| [ISSUE_3] | Minor    | Deferred to v2 |

---

## Implementation Notes

### Tailwind Classes Pattern

```tsx
// Container
<div className="container mx-auto px-4 py-6">

// Card
<Card className="p-6 space-y-4">

// Form layout
<form className="space-y-6">
```

### Animation Specifications

```tsx
// Page transition
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.3 }}
>

// List item stagger
<motion.div
  variants={itemVariants}
  initial="hidden"
  animate="visible"
>
```

---

## Sign-Off

- [ ] Gemini CLI review completed
- [ ] All Critical issues resolved
- [ ] Accessibility audit passed
- [ ] Responsive design verified
- [ ] Ready for implementation

**Approved By**: [NAME]
**Date**: [DATE]
