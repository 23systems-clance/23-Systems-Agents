# 05 — Skills System

## Overview

Skills are lightweight plugins (bash scripts or Node.js modules) that extend agent capabilities. They are the primary extensibility mechanism.

## Activation

Skills are activated via symlinks in `skills/active/`:

```bash
# Activate a skill
ln -s ../my-skill skills/active/my-skill

# Deactivate a skill
rm skills/active/my-skill
```

Both `.pi/skills` and `.claude/skills` are symlinks pointing to `skills/active/`, so Pi agents and Claude Code share the same active skill set.

## Skill Structure

Each skill directory contains:

```
skills/my-skill/
├── SKILL.md           # Required — metadata + instructions
├── run.sh             # Executable script (bash)
├── package.json       # Optional — for Node.js dependencies
└── node_modules/      # Optional — installed dependencies
```

### SKILL.md Format

```yaml
---
name: my-skill
description: One-line description shown in skill listings
---

## Instructions for the agent

Detailed usage instructions, parameters, examples.
The agent reads this to know how/when to use the skill.
```

The `description` from frontmatter populates the `{{skills}}` template variable in system prompts.

## Currently Active Skills

| Skill | Description | Type |
|-------|-------------|------|
| `brave-search` | Web search + content extraction via Brave Search API | Node.js |
| `youtube-transcript` | Fetch YouTube video transcripts for summarization | Node.js |
| `browser-tools` | Chrome DevTools Protocol automation (navigate, eval, screenshot, click) | Bash/Node.js |
| `notebooklm` | Google NotebookLM — create notebooks, add sources, generate artifacts | Node.js |
| `sop-generator` | Generate branded HTML SOP documents using Dev Labs template system | Bash/Node.js |
| `llm-secrets` | List available LLM-accessible credentials (auto-included) | Built-in |
| `modify-self` | Self-modification of config, cron, triggers, skills (auto-included) | Built-in |

## Available but Inactive Skills

| Skill | Description |
|-------|-------------|
| `google-docs` | Google Docs API integration |
| `google-drive` | Google Drive file management |
| `kie-ai` | KIE AI integration |

## Building a New Skill

Reference: `config/SKILL_BUILDING_GUIDE.md`

1. Create directory: `skills/my-skill/`
2. Create `SKILL.md` with YAML frontmatter (`name`, `description`) and usage instructions
3. Add executable script(s)
4. If Node.js, add `package.json` and run `npm install`
5. Activate: `ln -s ../my-skill skills/active/my-skill`
6. The agent will automatically discover it via the `{{skills}}` template variable

## Skill Invocation

- The agent reads `SKILL.md` files to understand available capabilities
- Skills are invoked by the agent as bash commands or Node.js module calls
- Working directory context is passed from the agent's current environment
- Skills can access `LLM_SECRETS` environment variables (secrets with `AGENT_LLM_*` prefix)
