# /new-api - Scaffold a New API Route

Scaffold a new Express API route with proper structure and Zod validation.

## Usage
```
/new-api <route-name>
```
Example: `/new-api campaigns` or `/new-api workflow-templates`

## What Gets Created

### 1. Route File: `src/routes/admin/<route-name>.ts`

Follow the existing pattern from other admin routes:

```typescript
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';

const router = Router();

// Zod schemas for request validation
const createSchema = z.object({
  // Define fields
});

const updateSchema = createSchema.partial();

// GET /api/admin/<route-name>
router.get('/', async (req: Request, res: Response) => {
  // List endpoint
});

// GET /api/admin/<route-name>/:id
router.get('/:id', async (req: Request, res: Response) => {
  // Detail endpoint
});

// POST /api/admin/<route-name>
router.post('/', async (req: Request, res: Response) => {
  // Create endpoint with Zod validation
});

// PUT /api/admin/<route-name>/:id
router.put('/:id', async (req: Request, res: Response) => {
  // Update endpoint with Zod validation
});

// DELETE /api/admin/<route-name>/:id
router.delete('/:id', async (req: Request, res: Response) => {
  // Delete endpoint
});

export default router;
```

### 2. Register in `src/routes/admin/index.ts`
- Import the new router and mount it at the appropriate path.

## Rules
- Always include Zod validation for POST/PUT request bodies.
- Follow existing patterns in `src/routes/admin/` for error handling and response format.
- Include proper TypeScript types for all parameters and return values.
- Ask the user what fields/model the route should handle before scaffolding.
