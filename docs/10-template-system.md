# 10 — Template System (SOP & HTML Documents)

## Overview

The template system generates branded HTML documents (SOPs, video summaries, proposals, technical docs) using a CSS variable-based theming architecture. All templates share a common brand configuration system.

## Template Location

```
references/SOP Templates/
├── brand-config.css                  # Master brand theme (all presets + variable bridge)
├── brand-reference.html              # Visual reference for all brand presets
├── youtube-summary-compact.html      # Single-page video notes
├── youtube-summary-detailed.html     # Multi-section deep dive with sidebar
└── youtube-summary-executive.html    # Executive brief format
```

## Brand Configuration (`brand-config.css`)

### How It Works

1. Add `<link rel="stylesheet" href="brand-config.css">` **after** the template's `<style>` block
2. Add `data-brand="presetname"` to the `<html>` tag
3. The preset overrides the template's default CSS variables

```html
<html lang="en" data-brand="midnight">
<head>
  <style>/* template's original styles */</style>
  <link rel="stylesheet" href="../SOP Templates/brand-config.css">
</head>
```

### Available Brand Presets

| Preset | Attribute | Colors |
|--------|-----------|--------|
| Dev Labs (default) | `data-brand="devlabs"` | Violet (#7c3aed) + Teal (#0d9488) |
| Midnight | `data-brand="midnight"` | Blue (#3b82f6) + Purple (#8b5cf6) |
| Ember | `data-brand="ember"` | Orange (#ea580c) + Red (#dc2626) |
| Forest | `data-brand="forest"` | Green (#059669) + Teal (#0d9488) |
| Slate | `data-brand="slate"` | Indigo (#4f46e5) + Indigo (#6366f1) |
| Sunrise | `data-brand="sunrise"` | Rose (#e11d48) + Amber (#d97706) |
| Arctic | `data-brand="arctic"` | Cyan (#0891b2) + Sky (#0ea5e9) |
| Tridorian | `data-brand="tridorian"` | Green (#00D26A) + Blue (#00BBFF) |

### CSS Variable Map

| Variable | Controls |
|----------|----------|
| `--brand-primary` | Main accent (buttons, numbers, active states, links) |
| `--brand-primary-lt` | Lighter tint (hover states, sidebar labels) |
| `--brand-primary-bg` | Subtle background tint |
| `--brand-primary-bdr` | Border for primary-bg elements |
| `--brand-secondary` | Secondary accent (gradients, alternate highlights) |
| `--brand-secondary-bg` | Subtle secondary background |
| `--brand-secondary-bdr` | Border for secondary-bg elements |
| `--brand-sidebar` | Sidebar background |
| `--brand-sidebar-hov` | Sidebar hover state |
| `--brand-surface` | Page background |
| `--brand-card` | Card/raised surface background |
| `--brand-text` | Primary text color |
| `--brand-text-mid` | Secondary/body text |
| `--brand-text-muted` | Tertiary/muted text |
| `--brand-border` | Default border |
| `--brand-border-lt` | Subtle/light border |
| `--brand-success/warn/danger/info` | Semantic state colors |
| `--brand-success-bg/warn-bg/danger-bg/info-bg` | Semantic backgrounds |

### Variable Bridge

The brand-config.css contains a **variable bridge** that maps `--brand-*` variables to each template family's native variable names:

| Template Family | Native Variables | Bridge Maps To |
|----------------|------------------|----------------|
| Modern Minimal (meeting recap, daily plans, strategy) | `--violet`, `--teal`, `--bg`, `--surface` | `--brand-primary`, `--brand-secondary`, etc. |
| Playbook (BDR playbook) | `--navy`, `--accent`, `--emerald` | Same brand variables |
| Proposal/SOW | `--charcoal`, `--gold`, `--cream` | Same brand variables |
| Technical Docs | `--ink`, `--cyan`, `--purple` | Same brand variables |

This means **one brand preset works across all templates** without modifying any template file.

### Creating a Custom Brand

Add a new block to `brand-config.css`:

```css
[data-brand="client-name"] {
  --brand-primary: #2E5BFF;        /* From client brand guide */
  --brand-primary-lt: #6C8CFF;     /* 30% lighter */
  --brand-primary-bg: #EEF2FF;     /* 95% lighter */
  --brand-primary-bdr: #D6DEFF;    /* 85% lighter */
  --brand-secondary: #00C48C;
  --brand-secondary-bg: #E6FFF6;
  --brand-secondary-bdr: #B3FFE0;
  --brand-sidebar: #0A1628;
  --brand-sidebar-hov: #152238;
  --brand-surface: #F8FAFF;
  --brand-card: #FFFFFF;
  --brand-text: #0A1628;
  --brand-text-mid: #4B5C7E;
  --brand-text-muted: #8E9BB7;
  --brand-border: #DDE3EF;
  --brand-border-lt: #EEF1F7;
  /* Semantic colors — usually keep defaults */
  --brand-success: #16a34a; --brand-success-bg: #f0fdf4;
  --brand-warn: #d97706; --brand-warn-bg: #fffbeb;
  --brand-danger: #e11d48; --brand-danger-bg: #fff1f2;
  --brand-info: #2563eb; --brand-info-bg: #eff6ff;
}
```

**Quick method**: Take client's primary hex → paste into uicolors.app → use 50/100/500/600 shades.

## Template Formats

### YouTube Summary — Compact (`youtube-summary-compact.html`)

Single-page layout with:
- Header strip (dark background, gradient accent bar)
- TL;DR card (gradient background)
- Key takeaways (numbered pill cards)
- Best quotes (teal left-border blockquotes)
- Topic timeline (timestamped rows with links)

### YouTube Summary — Detailed (`youtube-summary-detailed.html`)

Multi-section layout with fixed sidebar:
- Left sidebar navigation (numbered sections)
- Overview stats (duration, topics, takeaways, actions)
- Key takeaways with supporting quotes
- Topic breakdown with time ranges
- Action items (checkbox list)

### YouTube Summary — Executive (`youtube-summary-executive.html`)

Executive brief format:
- Full-width gradient header
- Executive summary card
- Numbered takeaways
- Notable quotes
- Topic grid (card-based layout)

## Template Placeholders

All templates use `{{PLACEHOLDER}}` syntax for dynamic content:

| Placeholder | Description |
|------------|-------------|
| `{{VIDEO_TITLE}}` | Video title |
| `{{CHANNEL_NAME}}` | YouTube channel name |
| `{{VIDEO_URL}}` | Full video URL |
| `{{DATE}}` | Generation date |
| `{{DURATION}}` | Video duration |
| `{{EXECUTIVE_SUMMARY}}` | Multi-paragraph summary |
| `{{TAKEAWAY_TITLE}}` | Takeaway heading |
| `{{TAKEAWAY_DESCRIPTION}}` | Takeaway detail |
| `{{QUOTE_TEXT}}` | Notable quote |
| `{{TIMESTAMP}}` | Display timestamp (e.g., "12:34") |
| `{{TIMESTAMP_SECONDS}}` | Numeric seconds for URL linking |
| `{{TOPIC_NAME}}` | Topic heading |
| `{{TOPIC_SUMMARY}}` | Topic description |

## Design System

- **Font**: Outfit (headings/body) + Space Mono (monospace/labels)
- **Gradients**: `linear-gradient(135deg, var(--brand-primary), var(--brand-secondary))`
- **Border radius**: 10-14px for cards, 6-8px for badges/pills
- **Logo**: `references/uploads/23 Systems Logo.png`
- **Brand line**: "23 Systems" with logo lockup
- **Footer**: "Generated by 23 Systems Agent"
