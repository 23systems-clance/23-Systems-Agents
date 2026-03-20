# MCP Servers Setup Guide

This guide will help you complete the installation of ref.tools and exa MCP servers for Claude Code.

## Exa MCP Server

### Using Claude Code Plugins (Recommended)

Run these commands in your next Claude Code session:

```bash
/plugin marketplace add exa-labs/exa-mcp-server
/plugin install exa-mcp-server
```

### Alternative: Manual Configuration

If you prefer manual setup, add this to your Claude Code MCP configuration:

**Using HTTP endpoint:**
```json
{
  "mcpServers": {
    "exa": {
      "type": "http",
      "url": "https://mcp.exa.ai/mcp",
      "headers": {}
    }
  }
}
```

**Using NPX (local):**
```json
{
  "mcpServers": {
    "exa": {
      "command": "npx",
      "args": ["-y", "exa-mcp-server"],
      "env": {
        "EXA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Get your API key from: https://dashboard.exa.ai/api-keys

## Ref.tools MCP Server

### Configuration

1. **Get your API key**: Visit https://ref.tools/keys to obtain your API key

2. **Add to MCP configuration**: Since ref.tools uses an HTTP-based streamable MCP server, add this configuration to your Claude Code settings:

```json
{
  "mcpServers": {
    "ref": {
      "type": "http",
      "url": "https://api.ref.tools/mcp",
      "headers": {
        "x-ref-api-key": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

Alternatively, you can pass the API key as a query parameter:

```json
{
  "mcpServers": {
    "ref": {
      "type": "http",
      "url": "https://api.ref.tools/mcp?apiKey=YOUR_API_KEY_HERE"
    }
  }
}
```

## Additional Tools Installed

### GitHub CLI (gh)
- Already installed at: `/opt/homebrew/bin/gh`
- Usage: `gh --help`

### GitHub SpecKit
- Installed via uvx
- Command: `specify` (not `speckit`)
- Usage:
  ```bash
  uvx --from git+https://github.com/github/spec-kit.git specify --help
  ```
- Initialize a project:
  ```bash
  uvx --from git+https://github.com/github/spec-kit.git specify init <PROJECT_NAME>
  ```

### Beads
- Installed via npm: `@beads/bd@0.46.0`
- Command location: `/Users/developerlabsai/.npm-global/bin/bd`
- Already initialized in this project at: `.beads/beads.db`
- Usage:
  ```bash
  /Users/developerlabsai/.npm-global/bin/bd --help
  /Users/developerlabsai/.npm-global/bin/bd quickstart
  ```

#### Beads + SpecKit Integration

The integration between Beads and SpecKit is manual. Recommended workflow:

1. **Use SpecKit for planning**: Create specifications and plans using `specify`
2. **Create Beads tasks**: Manually create Beads issues/epics from your SpecKit specs
3. **Track execution**: Use Beads to track the actual implementation

Example workflow:
```bash
# Create a spec with SpecKit
specify specify feature-name

# Create epic in Beads
bd create "Epic: Implement feature-name" --priority P0

# Add tasks from the spec
bd create "Task 1: Component setup" --parent <epic-id>
bd create "Task 2: API integration" --parent <epic-id>
```

## Verifying Installation

To verify all MCP servers are working:

1. Restart Claude Code
2. Run `/mcp` to see the list of connected MCP servers
3. You should see `exa` and `ref` in the list

## Troubleshooting

### Beads command not found
Add npm global bin directory to your PATH:
```bash
export PATH="$PATH:/Users/developerlabsai/.npm-global/bin"
```

Add this to your `~/.zshrc` or `~/.bashrc` to make it permanent.

### MCP servers not showing up
- Check your Claude Code MCP configuration at: `~/.config/claude/mcp.json`
- Ensure API keys are correctly set
- Restart Claude Code after configuration changes

## References

- Ref.tools Documentation: https://docs.ref.tools/install
- Exa MCP Documentation: https://docs.exa.ai/reference/exa-mcp
- GitHub SpecKit: https://github.com/github/spec-kit
- Beads: https://github.com/steveyegge/beads
