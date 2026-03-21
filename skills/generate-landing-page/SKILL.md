---
name: generate-landing-page
description: "Generate branded HTML landing pages and save them to references/Landing Pages/. Use when asked to create landing pages, marketing pages, or product pages."
---

# Generate Landing Page

Generate professional, branded HTML landing pages using the 23 Systems template system.

## Template Location

```
skills/generate-landing-page/landing-page-template.html
```

## Output Location

All generated landing pages MUST be saved to:

```
references/Landing Pages/
```

Use a descriptive kebab-case filename, e.g.:
- `references/Landing Pages/tech-stack-advisor-v1.html`
- `references/Landing Pages/saas-product-launch.html`
- `references/Landing Pages/ai-consulting-services.html`

## How to Create a Landing Page

1. Read the template:
   ```bash
   cat skills/generate-landing-page/landing-page-template.html
   ```

2. Copy and customize the template for the specific landing page. Replace:
   - `{{PAGE_TITLE}}` — Browser tab title (e.g., "23 Systems - AI Consulting")
   - `{{COMPANY_NAME}}` — Company or product name (e.g., "23 Systems")
   - `{{HERO_TAGLINE}}` — Short uppercase tagline above the headline
   - `{{HERO_HEADLINE}}` — Main headline (wrap key phrase in `<span class="hl">`)
   - `{{HERO_DESCRIPTION}}` — 1-2 sentence description below the headline
   - `{{CTA_TEXT}}` — Call-to-action button text (e.g., "Get Started", "Book a Call")
   - Nav links, feature cards, metrics, and section content

3. Choose a style variant by setting `data-style` on `<html>`:

   | Style | Description |
   |-------|-------------|
   | `terminal` | Dark, dev-forward with code preview and chat UI |
   | `minimal` | Clean, light with centered hero and simple layout |
   | `dark-hero` | Dark gradient hero with light content sections |
   | `gradient` | Gradient backgrounds with scroll-based sections |

4. Save the output to `references/Landing Pages/<descriptive-name>.html`

## 23 Systems Logo

The logo file is at:
```
references/uploads/23 Systems Logo.png
```
Templates can reference this logo via relative `<img>` path. The logo mark "23" can also be rendered as a styled `<div>` element.

## Design System

### Colors (Dark Theme)
| Variable | Value | Usage |
|----------|-------|-------|
| `--bg` | `#0a0a12` | Page background |
| `--surface` | `#12121e` | Card/panel backgrounds |
| `--surface-2` | `#1a1a2e` | Elevated surfaces |
| `--accent` | `#4361ee` | Primary accent (buttons, highlights) |
| `--accent-light` | `#6380f5` | Lighter accent for text highlights |
| `--teal` | `#0d9488` | Secondary accent |
| `--green` | `#22c55e` | Status indicators |

### Colors (Light Theme)
| Variable | Value | Usage |
|----------|-------|-------|
| `--light-bg` | `#f7f8fc` | Page background |
| `--white` | `#ffffff` | Card backgrounds |
| `--accent` | `#4361ee` | Primary accent |
| `--dark-text` | `#1e1e32` | Headings |
| `--mid-text` | `#50506e` | Body text |

### Typography
- **Primary font:** Inter (weights 300-800)
- **Mono font:** JetBrains Mono (for code, badges, metrics)
- **Headline:** 32-48px, weight 800, letter-spacing -1.5px
- **Body:** 14px, line-height 1.7

### Common Components
- **Logo mark:** 32x32 rounded square with "23", accent background
- **Metric cards:** Grid of stat boxes with mono-font values
- **Chat preview:** Simulated chat conversation with typing indicator
- **Feature cards:** Icon + title + description grid
- **CTA buttons:** Accent background, 8px border-radius, 600 weight

## When to Use

- Creating marketing or product landing pages
- Designing pages for specific services or features
- Building demo or showcase pages
- Any single-page marketing content that needs professional design
