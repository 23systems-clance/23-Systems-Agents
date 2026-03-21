import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Parse YAML-ish frontmatter from a SKILL.md file.
 * Handles simple key: value and key: "quoted value" pairs.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const meta = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.+?)"?\s*$/);
    if (m) {
      const val = m[2];
      meta[m[1]] = val === 'true' ? true : val === 'false' ? false : val;
    }
  }
  return meta;
}

/**
 * Load a public skill's configuration for the generic /consult/[skillId] route.
 * Returns null if the skill doesn't exist or isn't marked public.
 */
export function getPublicSkillConfig(skillId) {
  const cwd = process.cwd();
  const skillDir = resolve(cwd, 'skills', skillId);
  const skillMdPath = resolve(skillDir, 'SKILL.md');

  if (!existsSync(skillMdPath)) return null;

  const skillMd = readFileSync(skillMdPath, 'utf-8');
  const meta = parseFrontmatter(skillMd);

  if (!meta.public) return null;

  // Load public-config.json
  const configPath = resolve(skillDir, 'public-config.json');
  const config = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf-8'))
    : {};

  // Load conversation-tree.json
  const treePath = resolve(skillDir, 'conversation-tree.json');
  const conversationTree = existsSync(treePath)
    ? JSON.parse(readFileSync(treePath, 'utf-8'))
    : null;

  return {
    skillId,
    name: meta.name || skillId,
    description: meta.description || '',
    config,
    conversationTree,
  };
}

/**
 * List all skills that have public: true in their SKILL.md frontmatter.
 */
export function listPublicSkills() {
  const cwd = process.cwd();
  const skillsDir = resolve(cwd, 'skills');

  if (!existsSync(skillsDir)) return [];

  const { readdirSync, statSync } = require('fs');
  const entries = readdirSync(skillsDir);
  const publicSkills = [];

  for (const entry of entries) {
    if (entry === 'active') continue;
    const entryPath = resolve(skillsDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    const skillMdPath = resolve(entryPath, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    const skillMd = readFileSync(skillMdPath, 'utf-8');
    const meta = parseFrontmatter(skillMd);

    if (meta.public) {
      publicSkills.push({
        skillId: entry,
        name: meta.name || entry,
        description: meta.description || '',
      });
    }
  }

  return publicSkills;
}
