/**
 * Admin user management routes.
 *
 * CRUD operations for admin users. Only ADMIN role can manage users.
 */

import { Router } from 'express';
import bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '../../models/index.js';
import { requireAdmin } from '../../lib/adminAuth.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

export const usersRouter = Router();

// All user management routes require ADMIN role.
usersRouter.use(requireAdmin);

/**
 * GET /users
 * List all admin users.
 */
usersRouter.get('/', async (req, res) => {
  try {
    const users = await prisma.adminUser.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ users });
  } catch (error) {
    logger.error('Failed to list users', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to list users' });
  }
});

/**
 * POST /users
 * Create a new admin user.
 */
usersRouter.post('/', async (req, res) => {
  try {
    const { name, email, username, password, role } = req.body;

    if (!name || !email || !username || !password) {
      res.status(400).json({
        error: 'bad_request',
        message: 'name, email, username, and password are required',
      });
      return;
    }

    if (role && !['ADMIN', 'VIEWER'].includes(role)) {
      res.status(400).json({
        error: 'bad_request',
        message: 'role must be ADMIN or VIEWER',
      });
      return;
    }

    // Check for duplicate email or username.
    const existingEmail = await prisma.adminUser.findUnique({ where: { email } });
    if (existingEmail) {
      res.status(409).json({ error: 'conflict', message: 'Email already in use' });
      return;
    }

    const existingUsername = await prisma.adminUser.findUnique({ where: { username } });
    if (existingUsername) {
      res.status(409).json({ error: 'conflict', message: 'Username already in use' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Generate API key for the new user.
    const plainKey = `adm_${randomBytes(24).toString('hex')}`;
    const keyHash = createHash('sha256').update(plainKey).digest('hex');

    const user = await prisma.adminUser.create({
      data: {
        name,
        email,
        username,
        passwordHash,
        apiKeyHash: keyHash,
        role: role || 'VIEWER',
      },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    logAudit({
      action: 'admin_user_created',
      actorUserId: req.admin!.id,
      targetType: 'AdminUser',
      targetId: user.id,
      metadata: { role: user.role },
    }).catch(() => {});

    res.status(201).json({ ...user, apiKey: plainKey });
  } catch (error) {
    logger.error('Failed to create user', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to create user' });
  }
});

/**
 * PUT /users/:id
 * Update an admin user (name, email, role, isActive, password).
 */
usersRouter.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, isActive, password } = req.body;

    const existing = await prisma.adminUser.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'User not found' });
      return;
    }

    if (role && !['ADMIN', 'VIEWER'].includes(role)) {
      res.status(400).json({
        error: 'bad_request',
        message: 'role must be ADMIN or VIEWER',
      });
      return;
    }

    // Check email uniqueness if changing.
    if (email && email !== existing.email) {
      const dup = await prisma.adminUser.findUnique({ where: { email } });
      if (dup) {
        res.status(409).json({ error: 'conflict', message: 'Email already in use' });
        return;
      }
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) updateData.passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.adminUser.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    logAudit({
      action: 'admin_user_updated',
      actorUserId: req.admin!.id,
      targetType: 'AdminUser',
      targetId: id,
      metadata: { fields: Object.keys(updateData) },
    }).catch(() => {});

    res.json(user);
  } catch (error) {
    logger.error('Failed to update user', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to update user' });
  }
});

/**
 * DELETE /users/:id
 * Delete an admin user. Cannot delete yourself.
 */
usersRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.admin!.id) {
      res.status(400).json({ error: 'bad_request', message: 'Cannot delete yourself' });
      return;
    }

    const existing = await prisma.adminUser.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'User not found' });
      return;
    }

    await prisma.adminUser.delete({ where: { id } });

    logAudit({
      action: 'admin_user_deleted',
      actorUserId: req.admin!.id,
      targetType: 'AdminUser',
      targetId: id,
    }).catch(() => {});

    res.json({ message: 'User deleted' });
  } catch (error) {
    logger.error('Failed to delete user', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to delete user' });
  }
});
