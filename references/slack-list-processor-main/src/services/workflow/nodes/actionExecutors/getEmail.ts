/**
 * Action executor: Get email addresses for contacts via Apollo.io.
 *
 * Reads contacts from the execution context, applies quality gate
 * filtering, and enqueues a contact enrichment job with purpose=EMAILING.
 */

import { enrichmentQueue } from '../../../queue/queues.js';
import { loadQualityGateConfig } from '../../../qualityGate/config.js';
import { runQualityGate } from '../../../qualityGate/qualityGate.js';
import logger from '../../../../lib/logger.js';

/**
 * Enqueues email enrichment for contacts in the workflow context.
 *
 * @param params - Action parameters including sourceVariable.
 * @param context - Workflow execution context.
 */
export async function executeGetEmail(
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<void> {
  const sourceVariable = String(params.sourceVariable || 'contacts');
  const contacts = context[sourceVariable];

  if (!Array.isArray(contacts) || contacts.length === 0) {
    logger.warn('getEmail: no contacts found in context variable', { sourceVariable });
    context._getEmailResult = { contactCount: 0, status: 'skipped' };
    return;
  }

  // Apply quality gate filtering if clientId is available in context.
  const clientId = context._clientId as string | undefined;
  let filteredContacts = contacts;

  if (clientId) {
    try {
      const gateConfig = await loadQualityGateConfig(clientId);
      const rows = contacts.map((c: Record<string, unknown>) => ({
        email: String(c.email || ''),
        domain: String(c.domain || c.website || ''),
        companyName: String(c.companyName || c.company || ''),
      }));

      const { passedRows } = runQualityGate(rows, gateConfig, {
        emailColumn: 'email',
        domainColumn: 'domain',
        companyNameColumn: 'companyName',
      });

      const passedEmails = new Set(passedRows.map(r => r['email']?.toLowerCase()));
      filteredContacts = contacts.filter((c: Record<string, unknown>) =>
        passedEmails.has(String(c.email || '').toLowerCase()),
      );

      if (filteredContacts.length < contacts.length) {
        logger.info('getEmail: quality gate filtered contacts', {
          original: contacts.length,
          passed: filteredContacts.length,
          filtered: contacts.length - filteredContacts.length,
        });
      }
    } catch (err) {
      logger.warn('getEmail: quality gate failed, proceeding without filtering', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const companies = filteredContacts.map((c: Record<string, unknown>, idx: number) => ({
    jobCompanyId: String(c.id || `wf-${idx}`),
    domain: String(c.domain || c.website || ''),
    companyName: String(c.companyName || c.company || ''),
  })).filter(c => c.domain);

  if (companies.length === 0) {
    logger.warn('getEmail: no contacts with domains found');
    context._getEmailResult = { contactCount: 0, status: 'skipped' };
    return;
  }

  const jobId = `wf-email-${Date.now()}`;
  await enrichmentQueue.add('contact-enrichment', {
    jobId,
    companies,
    purpose: 'EMAILING',
  });

  context._getEmailResult = {
    jobId,
    contactCount: companies.length,
    status: 'queued',
  };

  logger.info('Email enrichment queued', { jobId, contactCount: companies.length });
}
