---
name: generate-sop
description: "Generate branded HTML Standard Operating Procedure documents using the Dev Labs template system. Use when asked to create SOPs, playbooks, runbooks, or procedural documentation."
---

# Generate SOP

Generate professional, branded HTML SOP documents using the Dev Labs Playbook template.

## Template Location

```
skills/generate-sop/sop-template.html
```

## How to Create an SOP

1. Read the template:
   ```bash
   cat skills/generate-sop/sop-template.html
   ```

2. Copy and customize the template for the specific SOP topic. Replace:
   - `{{SOP_TITLE}}` — Document title (e.g., "NotebookLM Skill SOP")
   - `{{DOC_TYPE}}` — Document type label (e.g., "STANDARD OPERATING PROCEDURE")
   - `{{VERSION}}` — Version number (e.g., "v1.0")
   - `{{LAST_UPDATED}}` — Date string (e.g., "March 2026")
   - `{{OWNER}}` — Document owner (e.g., "23 Systems")
   - Sidebar navigation links
   - Section content (numbered sections with sub-headers)

3. Apply branding by adding to the `<html>` tag:
   ```html
   <html lang="en" data-brand="devlabs">
   ```
   And link the brand CSS after the style block:
   ```html
   <link rel="stylesheet" href="../references/brand-config.css">
   ```

4. Save the output SOP to `references/` or the appropriate directory.

## 23 Systems Logo

The template includes the 23 Systems logo in the sidebar header. The logo file is at:
```
references/uploads/23 Systems Logo.png
```
All templates reference this logo via relative `<img>` path. Do not use the old robot SVG icon.

## Template Features

- **23 Systems logo** in sidebar header
- Fixed sidebar navigation with numbered section badges
- Cover section with dark gradient background
- Numbered section headers with accent badges
- Sub-headers with left accent border
- Bullet lists with accent-colored square bullets
- Numbered step lists with circular counters
- Data tables with alternating rows and hover effects
- Info/success/warning/danger callout boxes
- Code blocks with monospace font
- Print-optimized styles
- Mobile responsive
- Brand-configurable via `brand-config.css` (7 presets + custom)

## Available Brand Presets

| Preset | Primary | Secondary | Usage |
|--------|---------|-----------|-------|
| `devlabs` | Violet #7c3aed | Teal #0d9488 | Default |
| `midnight` | Blue #3b82f6 | Purple #8b5cf6 | Professional |
| `ember` | Orange #ea580c | Red #dc2626 | Bold |
| `forest` | Green #059669 | Teal #0d9488 | Natural |
| `slate` | Indigo #4f46e5 | Indigo #6366f1 | Corporate |
| `sunrise` | Rose #e11d48 | Amber #d97706 | Warm |
| `arctic` | Cyan #0891b2 | Sky #0ea5e9 | Cool |

## Callout Box Syntax

```html
<div class="info-box info">Informational note</div>
<div class="info-box success">Success / best practice</div>
<div class="info-box warning">Warning / caution</div>
<div class="info-box danger">Danger / critical warning</div>
```

## When to Use

- Creating operational documentation for skills, tools, or workflows
- Writing team playbooks or runbooks
- Documenting onboarding procedures
- Any structured procedural document that needs professional formatting
