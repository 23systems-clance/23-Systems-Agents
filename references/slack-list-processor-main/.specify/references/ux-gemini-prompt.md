# UI/UX Design Review Prompt for Gemini CLI

Copy this prompt template and fill in the `[PLACEHOLDERS]` before running with Gemini CLI.

---

## Prompt Template

```
You are a senior UI/UX designer reviewing a web application design. Provide detailed, actionable feedback.

## Project Context

**Application Type**: [PROJECT_TYPE - e.g., CRM, Dashboard, E-commerce]
**Tech Stack**: Next.js 14+, Tailwind CSS, shadcn/ui, Framer Motion
**Target Users**: [USER_PERSONAS - e.g., BDR Managers, Sales Reps, Admins]

## Design System Constraints

You MUST only suggest components from shadcn/ui:
- Button, Input, Select, Checkbox, Radio, Switch, Slider
- Dialog, Sheet, Drawer, Popover, Tooltip, DropdownMenu
- Table, DataTable, Card, Tabs, Accordion
- Form, Label, FormField, FormMessage
- Alert, AlertDialog, Toast, Badge
- Avatar, Skeleton, Progress, Separator
- Command, Calendar, DatePicker

Styling: Tailwind CSS only (no custom CSS)
Animations: Framer Motion for transitions
Icons: Lucide React icon library

## Screen/Component Being Designed

**Name**: [SCREEN_NAME - e.g., Campaign Creation Form]
**Purpose**: [PURPOSE - What user goal does this serve?]
**User Story**: [USER_STORY - As a..., I need to..., so that...]

## Data & Interactions

**Data Displayed**:
[LIST_DATA_FIELDS]

**User Actions**:
[LIST_ACTIONS - e.g., Create, Edit, Delete, Filter, Sort]

**Form Fields** (if applicable):
[LIST_FORM_FIELDS_WITH_TYPES]

## Current Design Description

[DESCRIBE_CURRENT_DESIGN_OR_WIREFRAME]

## Review Checklist - Provide Feedback On Each:

### 1. Layout & Visual Hierarchy
- Is the information architecture logical?
- Is the visual flow clear (F-pattern or Z-pattern)?
- Are primary actions visually prominent?
- Is whitespace used effectively?

### 2. Component Selection
- Are the right shadcn/ui components being used?
- Are there simpler alternatives?
- Is the component complexity justified?

### 3. Interaction Design
- Are click/tap targets large enough (44x44px minimum)?
- Are hover/focus states clear?
- Are transitions smooth but not distracting?
- Is the feedback immediate for user actions?

### 4. Accessibility (WCAG 2.1 AA)
- Color contrast ratios (4.5:1 text, 3:1 UI)
- Keyboard navigation flow
- Focus indicators
- Screen reader considerations
- ARIA labels where needed

### 5. Responsive Design
- Mobile-first approach?
- Breakpoint behavior (sm, md, lg, xl)
- Touch-friendly on mobile?
- Content reflow without horizontal scroll

### 6. States & Edge Cases
- Loading state (skeleton or spinner?)
- Empty state (first-time user experience)
- Error state (validation, API failures)
- Success state (confirmation feedback)
- Disabled state

### 7. Forms (if applicable)
- Field grouping and labels
- Inline validation timing
- Error message placement
- Required field indicators
- Help text usage

### 8. Performance Considerations
- Lazy loading opportunities
- Pagination vs infinite scroll
- Optimistic UI updates

## Output Format

Please provide:

1. **Overall Assessment** (1-2 sentences)
2. **Strengths** (bullet points)
3. **Issues to Address** (prioritized list with severity: Critical/Major/Minor)
4. **Specific Recommendations** (concrete changes with code snippets if helpful)
5. **Accessibility Audit** (pass/fail per criterion)
6. **Mobile Considerations** (specific responsive suggestions)

Be direct and specific. Reference shadcn/ui component names and Tailwind classes where relevant.
```

---

## Quick Fill Examples

### Example 1: Data Table Screen

```
**Name**: Contacts List
**Purpose**: View, filter, and manage all contacts in the CRM
**User Story**: As a BDR, I need to view and filter contacts so I can find prospects for my campaigns

**Data Displayed**:
- Name, Email, Phone, Company, Persona, Decision Maker status
- Enrichment status, Last activity date

**User Actions**:
- Filter by persona, company, enrichment status
- Sort by any column
- Bulk select for campaign assignment
- Export to CSV
- Click row to view detail

**Form Fields**: N/A (filters only)
```

### Example 2: Form Screen

```
**Name**: Campaign Creation Form
**Purpose**: Create a new outreach campaign with sequence steps
**User Story**: As a BDR Manager, I need to create campaigns so my team can execute outreach

**Data Displayed**:
- Existing sequence templates (for selection)
- Client list (for assignment)

**User Actions**:
- Enter campaign name, select client
- Choose existing sequence OR create inline
- Add/edit sequence steps (2-14 steps)
- Save as draft or activate

**Form Fields**:
- name (text, required)
- clientId (select, required)
- sequenceId (select, optional - if using template)
- steps[] (array of: type, templateContent, delayDays)
```

---

## Usage with Gemini CLI

```bash
# Option 1: Pipe the prompt
cat .specify/references/ux-gemini-prompt.md | gemini

# Option 2: Direct input
gemini -p "$(cat .specify/references/ux-gemini-prompt.md)"

# Option 3: Interactive mode
gemini
> [paste prompt]
```

---

## Post-Review Checklist

After receiving Gemini feedback:

- [ ] Address all Critical issues before implementation
- [ ] Address Major issues in first iteration
- [ ] Log Minor issues for future improvement
- [ ] Update wireframes/designs based on feedback
- [ ] Run /speckit.ux again if significant changes made
