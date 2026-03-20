# 23 Systems Agent — Technical Documentation

> Master index for all technical documentation. Each document is self-contained and can be referenced independently to minimize context window usage.

## Table of Contents

| # | Document | Description | When to Reference |
|---|----------|-------------|-------------------|
| 1 | [Architecture Overview](./01-architecture.md) | Two-layer system design, job lifecycle, data flow diagrams | Understanding how the system works end-to-end |
| 2 | [Directory Structure](./02-directory-structure.md) | Complete file tree with ownership (managed vs user-editable) | Finding where code lives, knowing what's safe to edit |
| 3 | [Database Schema](./03-database-schema.md) | All tables, columns, relationships, migration workflow | Modifying the database or understanding data models |
| 4 | [AI Agents & LLM Integration](./04-ai-agents.md) | LangGraph agents, LLM providers, tool definitions, MCP bridge | Modifying agent behavior, adding tools, changing LLM providers |
| 5 | [Specialties System](./05-skills.md) | Specialty structure, activation, SKILL.md format, building new specialties | Creating or modifying agent specialties |
| 6 | [Clusters & Workers](./06-clusters.md) | Cluster roles, triggers, Docker execution, concurrency control | Working with worker clusters or adding trigger types |
| 7 | [Configuration Files](./07-configuration.md) | All config/ files, template variables, markdown includes | Editing prompts, crons, triggers, or personality |
| 8 | [API & Authentication](./08-api-auth.md) | API endpoints, auth flow, API keys, WebSocket auth | Working with API routes or authentication |
| 9 | [Docker & Deployment](./09-docker-deployment.md) | Docker images, compose config, GitHub Actions workflows | Deployment, CI/CD, or container issues |
| 10 | [Template System](./10-template-system.md) | SOP/HTML templates, brand-config.css, variable bridge, presets | Creating branded documents or new templates |
| 11 | [Chat & Web UI](./11-chat-web-ui.md) | Chat system, streaming, components, web routes | Modifying the web interface or chat behavior |
| 12 | [Environment Variables](./12-environment-variables.md) | All env vars, GitHub secrets/variables, prefix conventions | Setting up or debugging configuration |

## Solved Issues & Debugging Knowledge

Investigated bugs and their solutions are documented in `references/solved/`:

| File | Issue |
|------|-------|
| [sidebar-footer-overflow.md](../references/solved/sidebar-footer-overflow.md) | Sidebar footer overflowing due to Radix UI inline-block wrappers |

When you solve a non-trivial bug, add a file here following the template in `.specify/CONSTITUTION.md`.

## Quick Reference

- **Tech Stack**: Next.js 15, React 19, NextAuth 5, Drizzle ORM (SQLite), LangChain/LangGraph, Docker
- **Core Package**: `23wf` (npm) — contains all business logic; this project is a thin shell
- **Database**: SQLite at `data/23wf.sqlite`
- **LLM Default**: Anthropic Claude Sonnet via `ANTHROPIC_API_KEY`
