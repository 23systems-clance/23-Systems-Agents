/**
 * Admin user seed script.
 *
 * Creates admin users with username/password and/or API key.
 *
 * Usage:
 *   npx tsx src/scripts/seedAdmin.ts --name "Admin" --email "admin@example.com" --username admin --password secret123 --role ADMIN
 *   npx tsx src/scripts/seedAdmin.ts --name "Viewer" --email "viewer@example.com" --username viewer --password secret123 --role VIEWER
 *   npx tsx src/scripts/seedAdmin.ts --name "API Only" --email "api@example.com" --api-key-only
 */

import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

interface Args {
  name: string;
  email: string;
  username?: string;
  password?: string;
  role: 'ADMIN' | 'VIEWER';
  apiKeyOnly: boolean;
}

/** Parse CLI arguments. */
function parseArgs(): Args {
  const args = process.argv.slice(2);
  let name = '';
  let email = '';
  let username: string | undefined;
  let password: string | undefined;
  let role: 'ADMIN' | 'VIEWER' = 'VIEWER';
  let apiKeyOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) {
      name = args[++i];
    } else if (args[i] === '--email' && args[i + 1]) {
      email = args[++i];
    } else if (args[i] === '--username' && args[i + 1]) {
      username = args[++i];
    } else if (args[i] === '--password' && args[i + 1]) {
      password = args[++i];
    } else if (args[i] === '--role' && args[i + 1]) {
      const r = args[++i].toUpperCase();
      if (r !== 'ADMIN' && r !== 'VIEWER') {
        console.error('Role must be ADMIN or VIEWER');
        process.exit(1);
      }
      role = r;
    } else if (args[i] === '--api-key-only') {
      apiKeyOnly = true;
    }
  }

  if (!name || !email) {
    console.error('Usage: npx tsx src/scripts/seedAdmin.ts --name "Name" --email "email" [--username user --password pass] [--role ADMIN|VIEWER] [--api-key-only]');
    process.exit(1);
  }

  if (!apiKeyOnly && (!username || !password)) {
    console.error('Either provide --username and --password, or use --api-key-only');
    process.exit(1);
  }

  return { name, email, username, password, role, apiKeyOnly };
}

async function main(): Promise<void> {
  const { name, email, username, password, role, apiKeyOnly } = parseArgs();

  const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Check for duplicate email.
    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      console.error(`Admin with email "${email}" already exists.`);
      process.exit(1);
    }

    // Check for duplicate username.
    if (username) {
      const existingUsername = await prisma.adminUser.findUnique({ where: { username } });
      if (existingUsername) {
        console.error(`Admin with username "${username}" already exists.`);
        process.exit(1);
      }
    }

    // Generate API key.
    const plainKey = `adm_${randomBytes(24).toString('hex')}`;
    const keyHash = createHash('sha256').update(plainKey).digest('hex');

    // Hash password if provided.
    const passwordHash = password ? await bcrypt.hash(password, 12) : null;

    await prisma.adminUser.create({
      data: {
        name,
        email,
        username: username ?? null,
        passwordHash,
        apiKeyHash: keyHash,
        role,
      },
    });

    console.log('Admin user created:');
    console.log(`  Name:     ${name}`);
    console.log(`  Email:    ${email}`);
    console.log(`  Role:     ${role}`);
    if (username) {
      console.log(`  Username: ${username}`);
    }
    console.log(`  API Key:  ${plainKey} (SAVE THIS — shown only once)`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
