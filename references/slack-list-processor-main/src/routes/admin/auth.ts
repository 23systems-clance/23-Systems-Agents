/**
 * Admin authentication routes.
 *
 * Handles username/password login, logout, and session status.
 * These routes are mounted BEFORE the adminAuth middleware so they
 * are accessible without authentication.
 */

import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

export const authRouter = Router();

/**
 * POST /auth/login
 * Authenticate with username and password, create session.
 */
authRouter.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({
        error: 'bad_request',
        message: 'Username and password are required',
      });
      return;
    }

    const admin = await prisma.adminUser.findUnique({
      where: { username },
    });

    if (!admin || !admin.passwordHash) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid username or password',
      });
      return;
    }

    if (!admin.isActive) {
      res.status(403).json({
        error: 'forbidden',
        message: 'Account is deactivated',
      });
      return;
    }

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid username or password',
      });
      return;
    }

    // Create session.
    req.session.adminId = admin.id;
    req.session.adminName = admin.name;
    req.session.adminRole = admin.role;

    logAudit({
      action: 'admin_login',
      actorUserId: admin.id,
      metadata: { method: 'password' },
    }).catch(() => {});

    res.json({
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    });
  } catch (error) {
    logger.error('Login error', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

/**
 * POST /auth/logout
 * Destroy session and clear cookie.
 */
authRouter.post('/logout', (req, res) => {
  const adminId = req.session.adminId;

  req.session.destroy((err) => {
    if (err) {
      logger.error('Logout error', { error: String(err) });
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to logout',
      });
      return;
    }

    res.clearCookie('connect.sid');

    if (adminId) {
      logAudit({
        action: 'admin_logout',
        actorUserId: adminId,
      }).catch(() => {});
    }

    res.json({ message: 'Logged out' });
  });
});

/**
 * GET /auth/me
 * Return current admin info from session. Also works with API key auth
 * if the request was already authenticated by adminAuth middleware.
 */
authRouter.get('/me', async (req, res) => {
  // Check session first.
  if (req.session.adminId) {
    const admin = await prisma.adminUser.findUnique({
      where: { id: req.session.adminId },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    if (admin && admin.isActive) {
      res.json({
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      });
      return;
    }

    // Session refers to invalid/inactive admin — destroy it.
    req.session.destroy(() => {});
  }

  // Check if authenticated via API key (adminAuth may have run).
  if (req.admin) {
    res.json({
      id: req.admin.id,
      name: req.admin.name,
      email: req.admin.email,
      role: 'ADMIN',
    });
    return;
  }

  res.status(401).json({
    error: 'unauthorized',
    message: 'Not authenticated',
  });
});
