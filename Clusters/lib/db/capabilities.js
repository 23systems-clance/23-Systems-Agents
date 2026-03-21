import fs from 'fs';
import path from 'path';
import { getDb } from './index.js';
import { capabilities } from './schema.js';
import { eq } from 'drizzle-orm';

/**
 * Scan skills/active/ and config/templates/ to seed the capabilities table.
 * Idempotent — uses upsert to keep the registry in sync with the filesystem.
 */
export async function seedCapabilities() {
  const db = getDb();
  const projectRoot = process.cwd();
  const now = Date.now();

  // Seed skills from skills/active/*/SKILL.md
  const skillsDir = path.join(projectRoot, 'skills', 'active');
  if (fs.existsSync(skillsDir)) {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const frontmatter = parseFrontmatter(content);
      if (!frontmatter.name) continue;

      const id = entry.name; // directory name as kebab-case id
      await upsertCapability(db, {
        id,
        type: 'skill',
        name: frontmatter.name,
        description: frontmatter.description || null,
        category: frontmatter.category || null,
        sourcePath: `skills/${entry.name}/`,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Seed team templates from config/templates/*.json
  const templatesDir = path.join(projectRoot, 'config', 'templates');
  if (fs.existsSync(templatesDir)) {
    const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(templatesDir, file), 'utf-8'));
        const id = data.id || file.replace('.json', '');
        await upsertCapability(db, {
          id,
          type: 'team_template',
          name: data.name || id,
          description: data.description || null,
          category: data.category || null,
          sourcePath: `config/templates/${file}`,
          createdAt: now,
          updatedAt: now,
        });
      } catch {
        // Skip invalid JSON files
      }
    }
  }
}

async function upsertCapability(db, values) {
  const existing = await db.select().from(capabilities).where(eq(capabilities.id, values.id));
  if (existing.length > 0) {
    await db.update(capabilities)
      .set({
        name: values.name,
        description: values.description,
        category: values.category,
        sourcePath: values.sourcePath,
        updatedAt: values.updatedAt,
      })
      .where(eq(capabilities.id, values.id));
  } else {
    await db.insert(capabilities).values(values);
  }
}

/**
 * Parse YAML frontmatter from a markdown file.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = value;
  }
  return result;
}
