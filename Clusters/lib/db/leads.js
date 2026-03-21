import { randomUUID } from 'crypto';
import { getDb } from './index.js';
import { leads } from './schema.js';
import { eq } from 'drizzle-orm';

export function createLead({ name, email, projectSummary, conversationJson, recommendationsJson, reportPath, personaMode, source }) {
  const db = getDb();
  const id = randomUUID();
  db.insert(leads).values({
    id,
    name,
    email,
    projectSummary: projectSummary || null,
    conversationJson: conversationJson ? JSON.stringify(conversationJson) : null,
    recommendationsJson: recommendationsJson ? JSON.stringify(recommendationsJson) : null,
    reportPath: reportPath || null,
    personaMode: personaMode || null,
    source: source || 'consult-page',
    createdAt: Date.now(),
  }).run();
  return id;
}

export function getLeadByEmail(email) {
  const db = getDb();
  return db.select().from(leads).where(eq(leads.email, email)).get();
}
