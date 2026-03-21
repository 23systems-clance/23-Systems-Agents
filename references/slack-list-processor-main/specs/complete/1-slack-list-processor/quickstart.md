# Quickstart: Slack List Processor

**Feature Branch**: `1-slack-list-processor`
**Date**: 2026-03-04

## Prerequisites

- **Node.js** >= 18.x (for native `fetch` support)
- **Redis** >= 6.x (local or remote for BullMQ)
- **PostgreSQL** >= 14.x (local or remote)
- **Slack Workspace** with admin permissions to install a custom app
- **API Keys**:
  - Slack Bot Token + App Token (Socket Mode)
  - BuiltWith API Key (Pro plan or higher)
  - Apollo.io API Key (Professional plan or higher)
  - Anthropic API Key (Claude 3.5 Haiku access)

## 1. Slack App Setup

### Create the Slack App

1. Go to https://api.slack.com/apps and click "Create New App"
2. Choose "From scratch"
3. Name: `List Processor` (or your preferred name)
4. Select your workspace

### Enable Socket Mode

1. Go to **Settings > Socket Mode**
2. Enable Socket Mode
3. Create an App-Level Token with `connections:write` scope
4. Save the token as `SLACK_APP_TOKEN`

### Configure Bot Scopes

Go to **OAuth & Permissions > Scopes > Bot Token Scopes** and add:
- `channels:history`
- `groups:history`
- `files:read`
- `files:write`
- `chat:write`
- `im:history`

### Enable Events

Go to **Event Subscriptions** and subscribe to:
- `file_shared`
- `message.channels`
- `message.groups`
- `app_mention`

### Enable Interactivity

Go to **Interactivity & Shortcuts** and toggle ON.
(No request URL needed for Socket Mode.)

### Install to Workspace

Go to **Install App** and click "Install to Workspace".
Save the `Bot User OAuth Token` as `SLACK_BOT_TOKEN`.

## 2. Project Initialization

```bash
mkdir slack-list-processor && cd slack-list-processor
npm init -y
npm install @slack/bolt bullmq @anthropic-ai/sdk xlsx csv-parse ioredis @prisma/client uuid express cors dotenv
npm install -D typescript @types/node @types/uuid @types/express @types/cors prisma tsx vitest
npx tsc --init
```

### TypeScript Configuration

Key `tsconfig.json` settings:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

## 3. Environment Variables

Create a `.env` file:

```env
# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret

# Redis (BullMQ)
REDIS_URL=redis://localhost:6379

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/list_processor

# BuiltWith
BUILTWITH_API_KEY=your-builtwith-api-key

# Apollo.io
APOLLO_API_KEY=your-apollo-api-key
APOLLO_WEBHOOK_SECRET=your-webhook-shared-secret

# Anthropic (AI Orchestrator)
ANTHROPIC_API_KEY=your-anthropic-api-key

# Application
NODE_ENV=development
LOG_LEVEL=debug
HTTP_PORT=3000
WEBHOOK_BASE_URL=https://your-domain.com
```

## 4. Project Structure

```
src/
├── app.ts                          # Bolt app + Express HTTP server startup
├── server.ts                       # Express HTTP server factory (REST API + webhooks)
├── config/
│   └── index.ts                    # Environment config loader
├── listeners/
│   ├── events/
│   │   ├── fileShared.ts           # file_shared event handler
│   │   └── message.ts              # Message handler (ENRICH detection)
│   └── actions/
│       ├── purposeSelection.ts     # Cold Calling/Emailing/etc buttons
│       ├── cosellCheck.ts          # Co-sell Yes/No buttons
│       ├── cloudProvider.ts        # Cloud provider selection
│       ├── reportFilters.ts        # Tech report filter inputs
│       └── cacheDecision.ts        # Use cached / fresh query
├── services/
│   ├── ai/
│   │   ├── orchestrator.ts         # Intent classification (Claude)
│   │   └── personaClassifier.ts    # Job title -> persona type
│   ├── builtwith/
│   │   ├── client.ts               # BuiltWith API client
│   │   ├── domainEnricher.ts       # Domain technographic enrichment
│   │   ├── listsClient.ts          # Technology reports (Lists API)
│   │   ├── companyResolver.ts      # Company name -> domain (CTU API)
│   │   ├── cloudExtractor.ts       # Cloud provider extraction
│   │   └── techSpendScorer.ts      # Technology spend tier scoring
│   ├── apollo/
│   │   ├── client.ts               # Apollo.io API client
│   │   ├── peopleSearch.ts         # Free people search
│   │   ├── peopleEnrich.ts         # People enrichment (credits)
│   │   └── bulkEnrich.ts           # Bulk enrichment (10 per request)
│   ├── file/
│   │   ├── parser.ts               # CSV/XLSX file parsing
│   │   ├── generator.ts            # Result file generation
│   │   └── slackFile.ts            # Slack file download/upload
│   ├── queue/
│   │   ├── queues.ts               # BullMQ queue definitions
│   │   └── workers/
│   │       ├── technographic.ts    # Technographic enrichment worker
│   │       ├── contact.ts          # Contact enrichment worker
│   │       ├── combined.ts         # Combined enrichment worker
│   │       ├── techReport.ts       # Tech report generation worker
│   │       └── fileGeneration.ts   # Result file generation worker
│   └── state/
│       └── conversationStore.ts    # Redis-backed conversation state
├── routes/
│   ├── health.ts                   # Health check endpoint
│   ├── jobs.ts                     # Job listing/detail API
│   └── webhooks/
│       └── apollo.ts               # Apollo phone webhook handler
├── models/
│   └── index.ts                    # Prisma client + type exports
├── lib/
│   ├── redis.ts                    # Redis/IORedis connection
│   ├── logger.ts                   # Structured logging
│   └── errors.ts                   # Custom error classes
└── data/
    ├── personaLookup.ts            # Title -> persona type lookup table
    ├── enterpriseTechs.ts          # Enterprise technology set
    ├── freeTechs.ts                # Free technology set
    └── cloudProviderKeywords.ts    # Cloud provider detection keywords

tests/
├── unit/
│   ├── services/
│   │   ├── techSpendScorer.test.ts
│   │   ├── cloudExtractor.test.ts
│   │   ├── personaClassifier.test.ts
│   │   └── fileParser.test.ts
│   └── data/
│       └── personaLookup.test.ts
├── integration/
│   ├── builtwith.test.ts
│   ├── apollo.test.ts
│   └── queue.test.ts
└── contract/
    └── webhookApollo.test.ts

prisma/
├── schema.prisma                   # Database schema
└── migrations/                     # Migration files
```

## 5. Minimal Boot Sequence

```typescript
// src/app.ts
import { App } from '@slack/bolt';
import { registerFileSharedListener } from './listeners/events/fileShared';
import { registerMessageListener } from './listeners/events/message';
import { registerActionListeners } from './listeners/actions';
import { startWorkers } from './services/queue/workers';
import { createHttpServer } from './server';
import { config } from './config';

const app = new App({
  token: config.slack.botToken,
  appToken: config.slack.appToken,
  socketMode: true,
});

// Register Slack event listeners
registerFileSharedListener(app);
registerMessageListener(app);
registerActionListeners(app);

// Start BullMQ workers
startWorkers();

// Start both Bolt (Socket Mode) and Express (HTTP) servers
(async () => {
  await app.start();
  console.log('Slack bot connected via Socket Mode');

  const httpServer = createHttpServer(config.httpPort);
  httpServer.listen(config.httpPort, () => {
    console.log(`HTTP server listening on port ${config.httpPort}`);
  });

  console.log('Slack List Processor is running!');
})();
```

## 6. Running Locally

```bash
# Start Redis (if not running)
redis-server

# Run database migrations
npx prisma migrate dev

# Start the application in dev mode
npx tsx src/app.ts
```

## 7. Verification

1. Invite the bot to a Slack channel: `/invite @List Processor`
2. Upload a CSV file with a "domain" column containing company domains
3. Bot should respond: "What would you like me to do with this list? Use ENRICH at the beginning of your sentence..."
4. Reply: "ENRICH this list with tech stacks"
5. Bot should acknowledge and begin processing
6. After processing, bot should upload the enriched file back to the thread
