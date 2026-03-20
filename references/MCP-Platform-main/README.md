# BuildWith MCP Server

A production-ready Model Context Protocol (MCP) server that provides AI assistants with access to BuildWith's technology profiling APIs. This server enables Claude and other MCP clients to query website technology stacks, find sites using specific technologies, and analyze web technology trends.

## Features

- **Full BuildWith API Support**: Access Free API, Domain API, and Lists API
- **Rate Limiting**: Automatic enforcement of BuildWith API limits (10 req/s, 8 concurrent)
- **Intelligent Caching**: LRU cache with TTL to minimize API calls
- **Exponential Backoff**: Automatic retry with exponential backoff and jitter
- **Type Safety**: Full TypeScript implementation with Zod validation
- **Production Ready**: Comprehensive error handling, logging, and monitoring

## Installation

### Prerequisites

- Node.js 20.0.0 or higher
- A BuildWith API key ([Get one here](https://api.builtwith.com/))

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd "MCP - Builtwith"
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Create a `.env` file (or set environment variables):
```bash
# Required
BUILTWITH_API_KEY=your_api_key_here

# Optional (with defaults)
MCP_CACHE_TTL=3600              # Cache TTL in seconds (default: 1 hour)
MCP_CACHE_SIZE=1000             # Max cache entries (default: 1000)
MCP_RATE_LIMIT_RPS=10           # Requests per second (default: 10)
MCP_MAX_CONCURRENT=8            # Max concurrent requests (default: 8)
MCP_LOG_LEVEL=info              # Log level: debug|info|warn|error
MCP_RETRY_MAX=3                 # Max retry attempts (default: 3)
```

## Usage

### With Claude Code

Add this server to your Claude Code configuration (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "builtwith": {
      "command": "node",
      "args": ["/path/to/MCP - Builtwith/dist/index.js"],
      "env": {
        "BUILTWITH_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Standalone

You can also run the server directly:

```bash
# With environment variables
BUILTWITH_API_KEY=your_key npm start

# Or using .env file
npm start
```

## Available Tools

### 1. `builtwith_free_lookup`

Get basic technology information for a domain.

**Parameters:**
- `domain` (string, required): Domain to lookup (e.g., "example.com")

**Example:**
```json
{
  "domain": "github.com"
}
```

### 2. `builtwith_domain_lookup`

Get comprehensive technology stack analysis for a domain.

**Parameters:**
- `domain` (string, required): Domain to analyze
- `hideMetadata` (boolean, optional): Hide descriptions, links, tags, categories
- `onlyLive` (boolean, optional): Return only currently active technologies

**Example:**
```json
{
  "domain": "github.com",
  "onlyLive": true,
  "hideMetadata": false
}
```

### 3. `builtwith_list_sites`

Find websites that use a specific technology.

**Parameters:**
- `technology` (string, required): Technology identifier (e.g., "WordPress", "React")
- `limit` (number, optional): Maximum number of results (default: 100)
- `includeMetadata` (boolean, optional): Include contact and company information
- `offset` (number, optional): Pagination offset
- `since` (string, optional): Filter results modified since date (YYYY-MM-DD)

**Example:**
```json
{
  "technology": "Next.js",
  "limit": 50,
  "includeMetadata": true
}
```

## Architecture

The server is built with a layered architecture:

```
┌─────────────────────────────────────────┐
│         MCP Client (Claude Code)         │
└────────────────┬────────────────────────┘
                 │ stdio/JSON-RPC
┌────────────────▼────────────────────────┐
│           MCP Server Layer               │
│  - Protocol handling                     │
│  - Tool routing                          │
│  - Input validation                      │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│          Service Layer                   │
│  - Business logic                        │
│  - Response formatting                   │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│         API Client Layer                 │
│  - Rate limiting (10 req/s)              │
│  - Concurrent limiting (8 max)           │
│  - LRU caching with TTL                  │
│  - Exponential backoff retry             │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│       BuildWith API                      │
└─────────────────────────────────────────┘
```

## Development

### Scripts

```bash
# Development with hot reload
npm run dev

# Build
npm run build

# Run tests
npm test

# Test with coverage
npm run test:coverage

# Lint
npm run lint

# Format code
npm run format

# Type check
npm run typecheck
```

### Project Structure

```
src/
├── config/              # Configuration loading and validation
├── infrastructure/      # Core infrastructure (rate limiter, cache, retry)
├── integration/         # BuildWith API client
├── services/           # Business logic layer
├── tools/              # MCP tool definitions and schemas
├── transport/          # MCP server transport layer
├── types/              # TypeScript type definitions
└── index.ts            # Entry point
```

## Configuration

All configuration is done through environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `BUILTWITH_API_KEY` | Your BuildWith API key | **Required** |
| `MCP_RATE_LIMIT_RPS` | Max requests per second | 10 |
| `MCP_MAX_CONCURRENT` | Max concurrent requests | 8 |
| `MCP_CACHE_ENABLED` | Enable caching | true |
| `MCP_CACHE_SIZE` | Max cache entries | 1000 |
| `MCP_CACHE_TTL` | Cache TTL in seconds | 3600 |
| `MCP_RETRY_MAX` | Max retry attempts | 3 |
| `MCP_RETRY_INITIAL_DELAY` | Initial retry delay (ms) | 1000 |
| `MCP_RETRY_MAX_DELAY` | Max retry delay (ms) | 60000 |
| `MCP_RETRY_BACKOFF_MULTIPLIER` | Backoff multiplier | 2 |
| `MCP_RETRY_JITTER_MAX` | Max jitter (ms) | 1000 |
| `MCP_LOG_LEVEL` | Log level | info |
| `MCP_LOG_PRETTY` | Pretty print logs | false |
| `MCP_METRICS_ENABLED` | Enable metrics | true |

## Error Handling

The server provides detailed error information:

- **Rate Limit Errors** (429): Automatically retried with exponential backoff
- **Authentication Errors** (401/403): Invalid API key
- **Validation Errors** (400): Invalid input parameters
- **Server Errors** (5xx): BuildWith API errors, automatically retried
- **Network Errors**: Connection failures, automatically retried

All errors include:
- Error message
- Error category
- Whether the error is retryable
- HTTP status code (if applicable)

## Monitoring

The server tracks the following metrics:

- Request counts by endpoint
- Error counts by category
- Cache hit/miss ratio
- Rate limiter wait times
- Retry attempts and backoff delays

## Security

- API keys are never logged (redacted automatically)
- All inputs validated with Zod schemas
- HTTPS for all API requests
- No sensitive data in error responses

## License

MIT

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

## Support

For issues and questions:
- BuildWith API Documentation: https://api.builtwith.com/
- MCP Protocol Specification: https://modelcontextprotocol.io/

## Acknowledgments

Built with:
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk) - MCP protocol implementation
- [Zod](https://github.com/colinhacks/zod) - TypeScript-first schema validation
- [Pino](https://github.com/pinojs/pino) - Fast and low overhead logging
- [Undici](https://github.com/nodejs/undici) - HTTP/1.1 client
