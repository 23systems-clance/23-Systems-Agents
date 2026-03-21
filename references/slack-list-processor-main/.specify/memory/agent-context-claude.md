# Agent Context: BDR Management Platform

**Last Updated**: 2025-12-06
**Project**: BDR Management Platform
**Tech Stack**: Next.js 14 (App Router), TypeScript 5.3, Prisma, PostgreSQL, React 18

## Overview

This file provides context for AI agents working on the BDR Management Platform. It contains architectural patterns, technology decisions, and implementation guidelines specific to this project.

## Technology Stack

### Core Framework

- **Next.js 14** with App Router pattern
- **TypeScript 5.3** with strict mode enabled
- **React 18** with Server Components
- **Prisma ORM** for database access
- **PostgreSQL** (via Supabase) for data persistence

### UI/UX Libraries

- **shadcn/ui** - Component library (Tailwind-based)
- **Tailwind CSS** - Utility-first styling
- **Radix UI** - Accessible primitives
- **React Hook Form** - Form state management
- **Zod** - Schema validation

### State Management

- **Zustand** - Client-side state management
  - Used for UI state (imports, campaigns, filters)
  - Supports persistence via localStorage
  - Pattern: `src/lib/stores/{feature}-store.ts`

### Authentication

- **NextAuth.js** - Authentication framework
  - Providers: Google OAuth, Credentials
  - Session management with JWT
  - Protected routes via session checks in API handlers

### Data Fetching

- **Server Components** for initial data loading
- **Client Components** with polling for real-time updates
- **API Routes** for mutations and third-party integrations

### AI/Agent Integration

- **Anthropic Claude API** via `@anthropic-ai/sdk`
  - Default model: `claude-sonnet-3.5`
  - Used for: Field mapping, data enrichment, conversation analysis
  - Cost tracking per Constitution Principle VI

## Project Structure

```
src/
├── app/                          # Next.js App Router
│   ├── (dashboard)/              # Protected dashboard routes
│   │   ├── layout.tsx            # Dashboard layout with nav
│   │   ├── settings/             # Settings pages
│   │   │   ├── page.tsx          # Settings navigation
│   │   │   └── import/           # CSV import UI (Spec 15)
│   │   │       └── page.tsx
│   │   ├── contacts/             # Contacts management
│   │   ├── accounts/             # Accounts management
│   │   └── campaigns/            # Campaign management
│   ├── (portal)/                 # Client portal routes
│   └── api/                      # API routes
│       └── v1/                   # API v1
│           ├── import/           # Import endpoints (Spec 15)
│           │   └── hubspot/
│           │       ├── upload/route.ts
│           │       ├── status/[jobId]/route.ts
│           │       └── history/route.ts
│           ├── contacts/         # Contact CRUD
│           ├── accounts/         # Account CRUD
│           └── plugins/          # Plugin integrations
│               ├── hubspot/
│               ├── instantly/
│               └── heyreach/
├── components/                   # React components
│   ├── ui/                       # shadcn/ui components
│   ├── settings/                 # Settings-specific components
│   │   ├── ImportUploadZone.tsx  # File upload dropzone (Spec 15)
│   │   ├── ImportProgressCard.tsx # Real-time progress (Spec 15)
│   │   └── ImportHistoryTable.tsx # Import history (Spec 15)
│   └── unibox/                   # Unified inbox components
├── lib/                          # Utilities and shared code
│   ├── stores/                   # Zustand stores
│   │   ├── import-store.ts       # Import state (Spec 15)
│   │   └── unibox-store.ts       # Inbox state
│   ├── hooks/                    # Custom React hooks
│   │   ├── useImportPolling.ts   # Progress polling (Spec 15)
│   │   └── useUniboxSSE.ts       # Inbox SSE connection
│   ├── api/                      # API client utilities
│   └── db/                       # Database utilities
│       └── prisma.ts             # Prisma client singleton
├── services/                     # Business logic layer
│   ├── hubspot-import/           # Import services (Spec 13)
│   │   ├── import-contacts.ts
│   │   ├── import-accounts.ts
│   │   └── csv-parser.ts
│   ├── contacts/                 # Contact services
│   ├── accounts/                 # Account services
│   └── unibox/                   # Unified inbox services
├── plugins/                      # WordPress-style plugins
│   ├── core/                     # Plugin framework
│   │   ├── registry.ts           # Plugin registration
│   │   ├── types.ts              # Plugin interfaces
│   │   └── loader.ts             # Plugin discovery
│   └── integrations/             # Third-party integrations
│       ├── hubspot/
│       ├── instantly/
│       └── heyreach/
└── types/                        # TypeScript type definitions
```

## Architectural Patterns

### 1. API-First Development (Constitution III)

All features expose REST API endpoints before building UI.

**Pattern**:

```typescript
// src/app/api/v1/{resource}/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  // 1. Extract session and validate authentication
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Extract clientId from session (multi-tenancy)
  const clientId = session.user.clientId;

  // 3. Validate request parameters with Zod
  const { searchParams } = new URL(request.url);
  const params = schema.parse(Object.fromEntries(searchParams));

  // 4. Execute business logic
  const result = await service.execute(clientId, params);

  // 5. Return response
  return NextResponse.json(result);
}
```

### 2. Multi-Tenancy & Client Isolation (Constitution IV)

All database queries scoped by `clientId`.

**Pattern**:

```typescript
// Always filter by clientId
const contacts = await prisma.contact.findMany({
  where: {
    clientId: session.user.clientId, // REQUIRED
    // ... other filters
  },
});

// Row-Level Security (RLS) in Supabase as defense-in-depth
```

### 3. Plugin Architecture (Constitution II)

WordPress-style plugins for third-party integrations.

**Plugin Structure**:

```typescript
// src/plugins/integrations/example/plugin.ts
export const examplePlugin: Plugin = {
  id: 'example',
  name: 'Example Integration',
  version: '1.0.0',

  // Lifecycle hooks
  onInstall: async (context) => {
    /* Setup logic */
  },
  onActivate: async (context) => {
    /* Activation logic */
  },

  // Capabilities
  routes: [{ path: '/api/v1/plugins/example/sync', handler: syncHandler }],
  uiComponents: [{ slot: 'settings', component: ExampleSettings }],
  permissions: ['read:contacts', 'write:contacts'],
  settings: {
    apiKey: { type: 'secret', required: true },
  },
};
```

### 4. Cost Tracking (Constitution VI)

All external API calls tracked for cost attribution.

**Pattern**:

```typescript
// Agent invocation example
const response = await anthropic.messages.create({
  model: 'claude-sonnet-3.5',
  messages: [{ role: 'user', content: prompt }],
});

// Track usage
await prisma.agentSession.create({
  data: {
    clientId,
    sessionType: 'FIELD_MAPPING',
    model: 'claude-sonnet-3.5',
    tokensInput: response.usage.input_tokens,
    tokensOutput: response.usage.output_tokens,
    cost: calculateCost(response.usage),
    input: { headers, sampleRows },
    output: { mappings },
  },
});
```

### 5. Real-Time Updates

**HTTP Polling** (default):

```typescript
// src/lib/hooks/useImportPolling.ts
export function useImportPolling(jobId: string) {
  const [status, setStatus] = useState<ImportJobStatus | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      const response = await fetch(`/api/v1/import/hubspot/status/${jobId}`);
      const data = await response.json();
      setStatus(data);

      // Stop polling when complete
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(data.status)) {
        clearInterval(interval);
      }
    }, 1000); // 1Hz polling

    return () => clearInterval(interval);
  }, [jobId]);

  return { status };
}
```

**Server-Sent Events** (for real-time features like inbox):

```typescript
// src/lib/hooks/useUniboxSSE.ts
export function useUniboxSSE() {
  useEffect(() => {
    const eventSource = new EventSource('/api/v1/unibox/events');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // Update store
    };

    return () => eventSource.close();
  }, []);
}
```

### 6. Form Validation

React Hook Form + Zod for all forms.

**Pattern**:

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  file: z.custom<File>((val) => val instanceof File, 'File is required')
    .refine((file) => file.size <= 50 * 1024 * 1024, 'File must be < 50MB')
    .refine((file) => file.name.endsWith('.csv'), 'Must be CSV'),
  importType: z.enum(['contacts', 'companies']),
});

export function ImportForm() {
  const form = useForm({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: z.infer<typeof schema>) => {
    // Handle submission
  };

  return <form onSubmit={form.handleSubmit(onSubmit)}>...</form>;
}
```

## Feature-Specific Context

### Spec 15: HubSpot CSV Upload UI

**Description**: Settings page UI for uploading HubSpot CSV files with agent-assisted field mapping.

**Key Technologies**:

- **File Upload**: Native Next.js `request.formData()` (no multer/formidable)
- **Real-Time Progress**: HTTP polling at 1Hz
- **Agent Integration**: Claude API for non-standard CSV header mapping
- **State Management**: Zustand store (`import-store.ts`)

**Mapping Strategies**:

1. **Deterministic** (fast path): Standard HubSpot CSVs use hardcoded mappings
2. **Agent-Assisted**: Non-standard CSVs analyzed by Claude agent
3. **Manual**: User manually selects field mappings (fallback)

**Agent Flow**:

```
1. User uploads non-standard CSV
2. Agent receives: { headers: string[], sampleRows: object[] }
3. Agent analyzes and returns:
   - Confident mappings: { sourceColumn, targetField, confidence }
   - Clarifications: { question, possibleMappings[], sampleData }
4. User responds to clarifications
5. Import executes with confirmed mappings
6. Mappings saved for reuse
```

**API Endpoints**:

- `POST /api/v1/import/hubspot/upload` - Upload CSV, initiate import
- `POST /api/v1/import/hubspot/clarify/:jobId` - Respond to agent clarifications
- `GET /api/v1/import/hubspot/status/:jobId` - Poll progress
- `GET /api/v1/import/hubspot/history` - Import history
- `GET /api/v1/import/hubspot/logs/:jobId` - Detailed logs
- `GET /api/v1/import/hubspot/download-errors/:jobId` - Error CSV

**Database Models**:

- `ImportJob` - Import operation tracking
- `FieldMapping` - CSV column → DB field mappings (reusable)
- `AgentSession` - AI agent invocation tracking (cost tracking)
- `MappingClarification` - User prompts for ambiguous mappings
- `ImportLogEntry` - Detailed record-level audit log

**Success Criteria**:

- Standard HubSpot CSVs bypass agent (< 5 second mapping)
- Agent mapping completes in < 30 seconds
- Agent correctly maps 90%+ fields without user intervention
- Progress updates < 2 second latency
- Agent costs < $0.10 per import

### Spec 13: HubSpot Field Mapping (Backend)

**Location**: `src/services/hubspot-import/`

**Services**:

- `import-contacts.ts` - Contact import orchestrator
- `import-accounts.ts` - Company/account import orchestrator
- `csv-parser.ts` - Streaming CSV parser
- `job-tracker.ts` - Progress tracking

**Field Mappings**:

- Contacts: 30+ standard HubSpot fields → Contact model
- Companies: 200+ fields → Account model + technographic data
- Deduplication: Email (contacts), domain (companies)

**Usage** (from Spec 15):

```typescript
import { importContacts } from '@/services/hubspot-import/import-contacts';

const jobId = await importContacts({
  clientId: session.user.clientId,
  file: csvFile,
  mappings: fieldMappings, // From agent or deterministic
  onProgress: (progress) => {
    // Update job tracker
  },
});
```

## Common Patterns

### Authentication in API Routes

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clientId = session.user.clientId;
  // ... rest of handler
}
```

### Prisma Client Usage

```typescript
import { prisma } from '@/lib/db/prisma';

// Always use singleton instance
const result = await prisma.contact.findMany({
  where: { clientId }, // Multi-tenancy
});
```

### Error Handling

```typescript
try {
  const result = await operation();
  return NextResponse.json(result);
} catch (error) {
  console.error('[API_ERROR]', error);

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: 'Validation failed', details: error.errors },
      { status: 400 }
    );
  }

  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
```

## Forbidden Patterns

### ❌ DO NOT USE middleware.ts

**Reason**: Violates Constitution Principle II (forbidden pattern)

**Instead**: Use authentication checks in API route handlers or layout components

### ❌ DO NOT Use getServerSideProps/getStaticProps

**Reason**: App Router uses Server Components instead

**Instead**: Use async Server Components for data fetching

### ❌ DO NOT Import Prisma Client Directly

**Reason**: Can cause connection pooling issues

**Instead**: Use singleton from `@/lib/db/prisma`

## Development Workflow

### 1. Feature Development (SpecKit)

```bash
# Create specification
/speckit.specify

# Generate implementation plan
/speckit.plan

# Generate tasks
/speckit.tasks

# Implement
/speckit.implement
```

### 2. Type Safety

```bash
# Check TypeScript compilation
npx tsc --noEmit

# Generate Prisma types
npx prisma generate
```

### 3. Database Changes

```bash
# Create migration
npx prisma migrate dev --name feature_name

# Apply to production
npx prisma migrate deploy
```

### 4. Testing

```bash
# Run tests
npm test

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

## Environment Variables Reference

```bash
# Database
DATABASE_URL="postgresql://..."

# Auth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="..."
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."

# AI/Agents
ANTHROPIC_API_KEY="sk-ant-..."  # Claude API
AGENT_MODEL="claude-sonnet-3.5" # Default agent model

# Third-Party Integrations
HUBSPOT_API_KEY="..."           # HubSpot plugin
INSTANTLY_API_KEY="..."         # Instantly.ai plugin
HEYREACH_API_KEY="..."          # HeyReach plugin

# Feature Flags
IMPORT_DEBUG="false"            # Enable import debug logging
```

## Performance Considerations

### File Upload

- Max file size: 50MB (configurable)
- Streaming parser for large CSVs
- Client-side validation before upload

### Real-Time Updates

- Polling at 1Hz (1 request/second)
- Stop polling when job complete
- Use SSE for high-frequency updates (inbox)

### Database Queries

- Always use indexes for clientId queries
- Batch operations for bulk imports
- Streaming for large result sets

## Security

### Multi-Tenancy Isolation

- All queries filtered by `clientId`
- Row-Level Security (RLS) in Supabase
- API routes validate client access

### Input Validation

- Zod schemas for all API inputs
- File type/size validation
- CSV parsing with error handling

### Authentication

- Session-based auth via NextAuth
- Protected routes check session
- API endpoints validate authentication

## References

- **Constitution**: `.specify/memory/constitution.md` - Project governance
- **Spec 15**: `specs/15-hubspot-csv-upload-ui/` - CSV upload UI feature
- **Spec 13**: `specs/13-hubspot-field-mapping/` - Import backend services
- **API Contracts**: `specs/*/contracts/*.yaml` - OpenAPI specifications
