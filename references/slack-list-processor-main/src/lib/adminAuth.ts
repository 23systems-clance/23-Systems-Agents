/**
 * Admin authentication middleware (dual auth).
 *
 * Supports two authentication methods:
 * 1. Session cookie — check req.session.adminId (from express-session)
 * 2. X-Admin-Key header — SHA-256 hash lookup against AdminUser table
 *
 * Either method grants access. Rejects with 401 if neither is valid.
 */

import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../models/index.js';
import { logAudit } from './auditLogger.js';
import logger from './logger.js';

/** Admin identity attached to authenticated requests. */
export interface AdminIdentity {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** Extend Express Request to carry admin identity. */
declare global {
  namespace Express {
    interface Request {
      admin?: AdminIdentity;
    }
  }
}

/**
 * Hashes an API key with SHA-256 for database lookup.
 */
export function hashAdminKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Express middleware: authenticates via session cookie or X-Admin-Key header.
 * Attaches admin identity to `req.admin`.
 */
export async function adminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Method 1: Session cookie.
    if (req.session?.adminId) {
      const admin = await prisma.adminUser.findUnique({
        where: { id: req.session.adminId },
      });

      if (admin && admin.isActive) {
        req.admin = {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
        };
        next();
        return;
      }

      // Session refers to invalid/inactive admin — destroy it.
      req.session.destroy(() => {});
    }

    // Method 2: X-Admin-Key header.
    const apiKey = req.headers['x-admin-key'] as string | undefined;

    if (apiKey) {
      const keyHash = hashAdminKey(apiKey);
      const admin = await prisma.adminUser.findUnique({
        where: { apiKeyHash: keyHash },
      });

      if (admin && admin.isActive) {
        req.admin = {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
        };

        logAudit({
          action: 'admin_authenticated',
          actorUserId: admin.id,
          metadata: { method: req.method, path: req.path },
        }).catch(() => {});

        next();
        return;
      }

      if (admin && !admin.isActive) {
        res.status(403).json({
          error: 'forbidden',
          message: 'Admin account is deactivated',
        });
        return;
      }
    }

    // Neither method succeeded.
    res.status(401).json({
      error: 'unauthorized',
      message: 'Authentication required',
    });
  } catch (error) {
    logger.error('Admin authentication error', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
}

/**
 * Middleware that restricts access to ADMIN role only.
 * Must be used after adminAuth.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.admin?.role !== 'ADMIN') {
    res.status(403).json({
      error: 'forbidden',
      message: 'Admin role required',
    });
    return;
  }
  next();
}
