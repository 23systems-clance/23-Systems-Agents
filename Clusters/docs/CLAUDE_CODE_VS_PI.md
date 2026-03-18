# Claude Code CLI vs Pi Coding Agent

thepopebot supports two agent backends for running jobs. Choose the one that fits your setup.

|  | Pi Coding Agent | Claude Code CLI |
|---|---|---|
| **What** | Third-party coding agent (@mariozechner) | Anthropic's official coding agent |
| **LLM providers** | Anthropic, OpenAI, Google, custom/local | Anthropic only (Claude models) |
| **Tools** | Custom skills (brave-search, browser-tools, etc.) | Built-in (Read, Edit, Bash, Glob, Grep, WebSearch, WebFetch) + MCP |
| **Auth** | API key (pay-per-token) | OAuth token (subscription) or API key |
| **Billing** | API credits | Pro/Max subscription (shared with Claude.ai) or API credits |
| **Choose when** | Non-Anthropic LLMs, custom Pi skills | Subscription billing, official Anthropic tooling |

## Switching backends

Run `thepopebot setup` to reconfigure, or set the `AGENT_BACKEND` GitHub variable directly:

```bash
# Switch to Claude Code
npx thepopebot set-var AGENT_BACKEND claude-code

# Switch to Pi
npx thepopebot set-var AGENT_BACKEND pi
```

## OAuth token setup

Claude Pro ($20/mo) and Max ($100+/mo) subscribers can generate a 1-year OAuth token:

```bash
# Install Claude Code CLI if needed
npm install -g @anthropic-ai/claude-code

# Generate token (opens browser for auth)
claude setup-token
```

The token starts with `sk-ant-oat01-`. The setup wizard stores it as the `AGENT_CLAUDE_CODE_OAUTH_TOKEN` GitHub secret.

**Note:** Anthropic only allows OAuth tokens with Claude Code, not the Messages API. Your API key is still required for event handler web chat. Pro users may hit usage limits sooner since limits are shared with Claude.ai.
