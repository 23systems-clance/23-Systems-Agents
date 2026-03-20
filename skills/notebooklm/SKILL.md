---
name: notebooklm
description: Google NotebookLM integration — create notebooks, add sources (URLs, YouTube, files), chat with sources, and generate artifacts (audio podcasts, videos, reports, quizzes, slide decks, infographics). Use for research synthesis, content generation, and source-grounded Q&A.
---

# NotebookLM

Programmatic access to Google NotebookLM via the `notebooklm` CLI. Create notebooks, add sources, ask questions, and generate artifacts (audio, video, reports, quizzes, slides, infographics, mind maps, data tables).

## Setup

Requires authentication with a Google account that has NotebookLM access.

1. **Install** (run once, or use `skills/notebooklm/install.sh`):
   ```bash
   pip install notebooklm-py
   ```

2. **Authenticate** — run locally on a machine with a browser:
   ```bash
   notebooklm login
   ```
   This creates `~/.notebooklm/storage_state.json` with session cookies.

3. **Set credential for Docker agent**:
   ```bash
   npx thepopebot set-agent-llm-secret NOTEBOOKLM_AUTH_JSON < ~/.notebooklm/storage_state.json
   ```
   The library reads `NOTEBOOKLM_AUTH_JSON` automatically — no file writes needed in CI/CD.

4. Also add to `.env` for local development:
   ```bash
   NOTEBOOKLM_AUTH_JSON='<contents of storage_state.json>'
   ```

## Install Script

Ensures Python and the `notebooklm` CLI are available in the Docker agent:

```bash
skills/notebooklm/install.sh
```

Run this at the start of any job that uses NotebookLM. It's idempotent — safe to call multiple times.

## Core Workflows

### Create a notebook and add sources

```bash
# Create a notebook
notebooklm create "My Research Topic"

# Set it as active (use the ID from create output)
notebooklm use <notebook_id>

# Add sources
notebooklm source add "https://example.com/article"
notebooklm source add "https://youtube.com/watch?v=xyz"
notebooklm source add ./document.pdf
notebooklm source add "Paste raw text content here"
```

### Ask questions (source-grounded Q&A)

```bash
notebooklm ask "What are the key themes across these sources?"
notebooklm ask "Summarize the main arguments" --json
notebooklm ask "Compare viewpoints" -s <source_id_1> -s <source_id_2>
notebooklm ask "Explain concept X" --save-as-note
```

### Generate audio (podcast)

```bash
# Deep-dive podcast (default)
notebooklm generate audio --wait
notebooklm download audio ./podcast.mp3

# Other formats
notebooklm generate audio --format brief --wait
notebooklm generate audio --format debate --wait
notebooklm generate audio "Focus on the history section" --format deep-dive --length long --wait
```

### Generate video

```bash
notebooklm generate video --wait
notebooklm generate video --format explainer --style whiteboard --wait
notebooklm download video ./explainer.mp4
```

### Generate reports

```bash
notebooklm generate report --format briefing-doc --wait
notebooklm generate report --format study-guide --wait
notebooklm generate report --format blog-post --wait
notebooklm download report ./report.md
```

### Generate other artifacts

```bash
# Slide deck
notebooklm generate slide-deck --wait
notebooklm download slide-deck ./slides.pdf
notebooklm download slide-deck ./slides.pptx --format pptx

# Quiz
notebooklm generate quiz --difficulty hard --wait
notebooklm download quiz ./quiz.md --format markdown

# Flashcards
notebooklm generate flashcards --wait
notebooklm download flashcards ./cards.json

# Infographic
notebooklm generate infographic --orientation landscape --wait
notebooklm download infographic ./info.png

# Mind map
notebooklm generate mind-map
notebooklm download mind-map ./map.json

# Data table
notebooklm generate data-table "compare all concepts" --wait
notebooklm download data-table ./data.csv
```

## Management Commands

```bash
# List notebooks
notebooklm list

# List sources in active notebook
notebooklm source list

# List generated artifacts
notebooklm artifact list

# Get notebook summary
notebooklm summary

# Get source full text
notebooklm source fulltext <source_id>

# Delete a source
notebooklm source delete <source_id>

# Delete a notebook
notebooklm delete <notebook_id>

# Check auth status
notebooklm auth check --test
```

## Research Agent

```bash
# Web research — adds findings as sources
notebooklm source add-research "topic to research" --mode deep --import-all

# Google Drive research
notebooklm source add-research "topic" --from drive --import-all
```

## Sharing

```bash
# Make notebook public
notebooklm share set-public true

# Share with specific user
notebooklm share add-user "user@example.com" --permission editor
```

## Notes

```bash
notebooklm note list
notebooklm note create "My analysis notes..."
notebooklm note get <note_id>
```

## Branded Report Templates

HTML report templates are available in `skills/notebooklm/templates/` for generating polished, branded output from NotebookLM research. These use the SOP template framework with the 23 Systems brand preset (midnight).

### ICP Report

Template: `skills/notebooklm/templates/icp-report-template.html`
Output directory: `references/reports/`

**Workflow — this is the standard flow for all ICP research:**

1. **Research the target company** — use `brave-search` skill or `skills/brave-search/content.js` to extract content from:
   - Company homepage
   - Services/solutions pages
   - Industries/verticals pages
   - LinkedIn company page (`https://www.linkedin.com/company/<name>/`)
   - Any other relevant public pages (blog, about, case studies)

2. **Extract company branding (REQUIRED)** — the report MUST be styled with the target company's brand identity, not 23 Systems defaults:
   - **Colors:** Inspect the site CSS/HTML for hex colors (primary, secondary, accent). Use `curl -sL "https://<company>.com" | grep -ioE '#[0-9a-fA-F]{3,8}' | sort | uniq -c | sort -rn` to find dominant colors.
   - **Logo:** Find the company logo (SVG preferred for cover, PNG also works). Check the site's `<nav>` element, favicon, or common paths like `/logo.svg`, `/images/logo.png`. For SVG logos, you can inline them as base64 data URIs in the cover section.
   - **Save logo to:** `references/logos/<company>-logo.png` (and/or `.svg`). This is the canonical logo directory — do NOT use `references/uploads/` for logos.
   - **Brand preset:** Create a `[data-brand="<company>"]` preset in `references/SOP Templates/brand-config.css` using the extracted colors. Map `--brand-primary`, `--brand-secondary`, and derived variables to the company's palette.
   - **Apply branding:** Set `data-brand="<company>"` on the report's `<html>` tag. This drives all accent colors, section numbers, tags, info boxes, and gradient accents throughout the report.
   - **Two-logo system:**
     - **Sidebar logo** = 23 Systems (`../logos/23-systems-logo.png`) — this is our authorship mark, always stays
     - **Cover logo** = target company logo — displayed prominently in the cover section with company tagline (e.g., "Google Cloud Premier Partner · tridorian.com")
   - Reference the Tridorian report at `references/reports/tridorian-icp-report.html` as the gold-standard example

3. **Create a NotebookLM notebook and add sources:**
   ```bash
   notebooklm create "<Company> ICP Research" --json
   notebooklm use <notebook_id>
   notebooklm source add "https://<company>.com"
   notebooklm source add "https://<company>.com/services"
   notebooklm source add "https://<company>.com/solutions"
   notebooklm source add "https://<company>.com/industries"
   notebooklm source add "https://www.linkedin.com/company/<company>/"
   ```

4. **Generate the NotebookLM briefing report:**
   ```bash
   notebooklm generate report --format briefing-doc --wait
   notebooklm download report ./references/reports/MD\ files/<company>-icp-report.md
   ```

5. **Produce the branded HTML report** using the ICP report template at `skills/notebooklm/templates/icp-report-template.html`. Fill in all 10 standard sections using data from the research + NotebookLM briefing. Save to:
   - **HTML report:** `references/reports/<company>-icp-report.html`
   - **Markdown report:** `references/reports/MD files/<company>-icp-report.md`

**Output directories:**
- `references/reports/` — branded HTML reports
- `references/reports/MD files/` — raw markdown reports from NotebookLM

**Reference report:** `references/reports/tridorian-icp-report.html` — use this as the definitive example for layout, tone, section structure, branding, and logo placement.

**Template features:**
- 23 Systems logo in sidebar (authorship), target company logo + branding in cover and accents
- Brand preset via `data-brand="<company>"` on `<html>` tag, linked to `references/SOP Templates/brand-config.css`
- Sidebar navigation with 10 standard ICP sections
- Stat cards, tag groups, blockquote testimonials, info callout boxes
- Responsive + print-optimized
- All relative paths assume report output is in `references/reports/`

**Standard ICP sections:**
1. Executive Summary (stat cards for key metrics)
2. Company Overview (firmographics table)
3. Services & Capabilities (tech stack, compliance tags)
4. Target Industries (challenges + stats table)
5. Ideal Customer Profile (fit criteria + disqualifiers)
6. Buyer Personas (primary/secondary/tertiary)
7. Customer Evidence (blockquote testimonials)
8. Competitive Positioning (strengths/vulnerabilities, GTM steps)
9. Engagement Strategy (entry points, messaging, discovery topics)
10. Contact & Global Presence (offices, phone numbers, key people)

## Tips

- Always run `skills/notebooklm/install.sh` before using NotebookLM commands in a job.
- Use `--wait` with generate commands to block until the artifact is ready for download.
- Use `--json` for machine-readable output when chaining commands.
- Audio generation can take 2-5 minutes depending on source length.
- The `NOTEBOOKLM_AUTH_JSON` env var is read automatically — no file setup needed.
- Google session cookies expire periodically; re-run `notebooklm login` and update the secret if auth fails.
- Use `notebooklm auth check --test` to verify credentials are working.
