# Research: Client Document Management

**Feature Branch**: `2-client-doc-management`
**Date**: 2026-03-05
**Status**: Complete

## 1. Document Conversion Libraries

### 1.1 DOCX to Markdown: mammoth + turndown

**Decision**: Use `mammoth` for DOCX-to-HTML conversion, then `turndown` + `turndown-plugin-gfm` for HTML-to-Markdown.

**Rationale**:
- mammoth (v1.8.x) is actively maintained (last updated 2024), ~400K weekly downloads, built-in TypeScript types, ~500 KB unpacked.
- Produces clean semantic HTML by mapping DOCX styles to headings (H1-H6), paragraphs, bold/italic, lists, and tables.
- turndown (v7.2.0) is mature (~800K weekly downloads, updated 2024), extensible via plugins.
- `turndown-plugin-gfm` adds GitHub Flavored Markdown table support.
- Pipeline: DOCX → mammoth → HTML → turndown → Markdown preserves document structure.

**Alternatives Rejected**:
- `officeparser`: Text extraction only -- no structural preservation (headings, tables, lists lost).
- Direct DOCX parsing with `xml2js`: Too low-level; would require reimplementing mammoth's style mapping.

**Dependencies**: `mammoth`, `turndown`, `turndown-plugin-gfm`, `@types/turndown`

### 1.2 PDF to Markdown: pdf-parse

**Decision**: Use `pdf-parse` for text extraction from text-based PDFs.

**Rationale**:
- Wraps Mozilla's PDF.js (the engine behind Firefox's PDF viewer).
- ~1M+ weekly downloads, MIT license.
- Returns plain text (no structural info), which is acceptable per spec assumption that PDFs are "primarily text-based documents."
- Simple API: `const result = await pdfParse(buffer); return result.text;`

**Caveats**:
- Unmaintained since 2019. Mitigated by: (a) underlying PDF.js is still maintained by Mozilla, (b) text extraction is stable functionality unlikely to break, (c) wrapping in try-catch with user-facing error message.
- Loses all formatting (headings, tables, page breaks) -- acceptable for one-pager PDFs where content is more important than structure.
- 24 MB unpacked size due to bundled test PDFs.

**Alternative considered**:
- `pdfjs-dist` directly: Actively maintained, removes unmaintained wrapper. More code (~20 lines vs 1 line) but full control. Listed as future migration option if pdf-parse causes issues.
- `pdf2md`: Pre-1.0, ~2K weekly downloads, heuristic-based structure detection -- too fragile for production.

**Dependencies**: `pdf-parse`, `@types/pdf-parse`

### 1.3 XLSX to Markdown: xlsx (SheetJS)

**Decision**: Use existing `xlsx` dependency (already installed) with a custom formatter.

**Rationale**:
- Already in `package.json` for the enrichment feature's file parsing.
- `XLSX.utils.sheet_to_json()` provides structured data; format as markdown tables.
- No new dependencies needed.

**Approach**: Iterate sheets, convert each to a markdown table with headers and rows.

### 1.4 Markdown / Plain Text

**Decision**: Pass-through (no conversion). Validate size only.

## 2. Settings Document Parsing

### 2.1 Format: YAML Front Matter

**Decision**: Use YAML front matter convention with `gray-matter` library for parsing.

**Rationale**:
- Industry standard (Jekyll, Hugo, Docusaurus, MDX) -- users familiar with docs tooling will recognize it.
- `gray-matter` library: 6M+ weekly downloads, actively maintained, MIT license.
- Clean separation between structured data (parsed programmatically) and free-form prose (passed as AI context).
- YAML naturally handles numbers, strings, arrays, and booleans without custom type coercion.
- Maps directly to FR-006a: recognized keys → programmatic overrides; unrecognized keys + free-text → AI context.

**Alternatives Rejected**:
- Custom key-value format: No standard, ambiguous edge cases (colons in values), no separation between config and notes.
- Markdown table convention: Fragile parsing, verbose for simple key-value data.

**Example**:
```markdown
---
decision_makers: 3
personas:
  - IT Leader
  - Engineering Leader
  - CEO
max_rows: 2000
instantly_campaign_id: camp_abc123
---

# Acme Corp Settings

Additional context about enrichment preferences.
```

**Dependencies**: `gray-matter`

## 3. Docs Channel Detection

### 3.1 Approach: Naming Convention + Explicit Registration

**Decision**: Dual detection -- channels matching `*-docs` or `*-documents` naming pattern, plus explicit registration via `DocsChannelConfig` table.

**Rationale**:
- Naming convention provides zero-config experience for most teams.
- Explicit registration handles edge cases where channel names don't follow convention.
- Cached in Redis (`doc-channel:{teamId}` set, 1hr TTL) for fast lookup on every `file_shared` event.

## 4. Document Classification Strategy

### 4.1 Filename Convention + AI Fallback with Always-Confirm

**Decision**: Suggest type from filename prefix, fall back to AI content analysis, but always present confirmation buttons.

**Rationale**:
- Per clarification Q4 (session 2026-03-05): always present buttons regardless of confidence level.
- Filename prefixes (`icp-*`, `usecase-*`, `settings-*`, `onepager-*`) provide fast initial suggestion.
- AI fallback (Claude 3.5 Haiku with `classify_document` tool) handles arbitrary filenames.
- Users always have final say via Block Kit buttons -- reduces misclassification risk.

### 4.2 AI Classification Model

**Decision**: Claude 3.5 Haiku (`claude-haiku-4-5-20251001`) with Tool Use, matching existing orchestrator pattern.

**Rationale**:
- Same model already used for intent classification in feature 1.
- Tool Use forces structured output (document_type, confidence, suggested_label, summary).
- Max 200 tokens output -- fast and cheap for classification.
- System prompt with 5 document type definitions ensures consistent classification.

## 5. Conversion Pipeline Architecture

### 5.1 BullMQ Worker

**Decision**: New `document-processing` queue with dedicated worker, following existing queue patterns.

**Rationale**:
- PDF/DOCX conversion can take 2-10 seconds -- too slow for synchronous Slack event handling (3-second acknowledgment window).
- BullMQ already in use for enrichment, phone data, and file generation queues.
- Same connection options, retry strategy (3 attempts, exponential backoff), and worker pattern.

### 5.2 Conversion Pipeline Flow

```
file_shared event
  → validate channel (docs channel?)
  → validate MIME type + file size
  → if markdown/text: download → classify → post buttons
  → if PDF/DOCX/XLSX: post "Converting..." → enqueue job
      → worker: download → convert → upload S3 → classify → post buttons
  → user confirms type → index document → update TOC
```

## 6. New Dependency Summary

| Package | Version | Purpose | Size |
|---------|---------|---------|------|
| `mammoth` | ^1.8.0 | DOCX → HTML | ~500 KB |
| `turndown` | ^7.2.0 | HTML → Markdown | ~60 KB |
| `turndown-plugin-gfm` | ^1.0.2 | GFM table support for turndown | ~10 KB |
| `pdf-parse` | ^1.1.1 | PDF text extraction | ~24 MB (inflated by test files) |
| `gray-matter` | ^4.0.3 | YAML front matter parsing | ~200 KB |
| `@types/turndown` | latest | TypeScript types | dev |
| `@types/pdf-parse` | latest | TypeScript types | dev |

**Note**: `jsdom` may be needed as a peer dependency for turndown in Node.js. Verify during implementation -- if turndown requires a DOM implementation, add `jsdom` (~5 MB).
