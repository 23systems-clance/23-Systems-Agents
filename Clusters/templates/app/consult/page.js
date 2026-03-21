import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';
import { ConsultPage, ConsultIndexPage } from '23wf/chat';

function getPublicSkills() {
  const skillsDir = resolve(process.cwd(), 'skills');
  if (!existsSync(skillsDir)) return [];

  const entries = readdirSync(skillsDir);
  const skills = [];

  for (const entry of entries) {
    if (entry === 'active') continue;
    const entryPath = resolve(skillsDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    const skillMdPath = resolve(entryPath, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    const content = readFileSync(skillMdPath, 'utf-8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    const meta = {};
    for (const line of fmMatch[1].split('\n')) {
      const m = line.match(/^(\w+):\s*"?(.+?)"?\s*$/);
      if (m) {
        const val = m[2];
        meta[m[1]] = val === 'true' ? true : val === 'false' ? false : val;
      }
    }
    if (!meta.public) continue;

    const hasTree = existsSync(resolve(entryPath, 'conversation-tree.json'));
    if (!hasTree) continue;

    let config = {};
    const configPath = resolve(entryPath, 'public-config.json');
    if (existsSync(configPath)) {
      try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch {}
    }

    skills.push({
      skillId: entry,
      name: meta.name || entry,
      description: meta.description || '',
      title: config.title || '',
      accent: config.accent || '#4361ee',
    });
  }

  return skills;
}

export default function ConsultRoute() {
  const publicSkills = getPublicSkills();

  // If only one public skill (tech-stack-advisor), show the bespoke page directly
  if (publicSkills.length <= 1) {
    const treePath = resolve(process.cwd(), 'skills/tech-stack-advisor/conversation-tree.json');
    const conversationTree = existsSync(treePath)
      ? JSON.parse(readFileSync(treePath, 'utf-8'))
      : null;
    return <ConsultPage conversationTree={conversationTree} />;
  }

  // Multiple public skills — show the directory
  return <ConsultIndexPage skills={publicSkills} />;
}
