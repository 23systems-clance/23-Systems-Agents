/**
 * Prisma client singleton module.
 *
 * Provides a single shared PrismaClient instance across the application.
 * In development, the instance is stored on globalThis to prevent
 * connection exhaustion caused by hot-reload re-imports.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { config } from '../config/index.js';

/** Extend globalThis so TypeScript accepts the cached client property. */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Shared Prisma client instance.
 *
 * Re-uses an existing instance from globalThis when available (development),
 * or creates a new one (production / first import).
 *
 * Prisma v7 requires a driver adapter for database connections.
 * In production (ECS Fargate), RDS PostgreSQL requires SSL with Amazon's CA.
 */
const pool = new pg.Pool({
  connectionString: config.database.url,
  ...(config.nodeEnv === 'production' ? { ssl: { rejectUnauthorized: false } } : {}),
});

const adapter = new PrismaPg(pool);

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Gracefully disconnect the Prisma client.
 *
 * Call this during application shutdown to release database connections.
 */
export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

export default prisma;

/** Re-export Prisma namespace and all generated types. */
export { Prisma } from '@prisma/client';
