/**
 * BuildWith Service
 * Business logic orchestration for BuildWith operations
 */

import type { ServerConfig } from '../types/config.js';
import type { Logger } from '../infrastructure/logger.js';
import { BuildWithClient } from '../integration/builtwith-client.js';
import type { DomainLookupOptions, ListSitesOptions } from '../integration/builtwith-client.js';

export class BuildWithService {
  private client: BuildWithClient;
  private logger: Logger;

  constructor(config: ServerConfig, logger: Logger) {
    this.client = new BuildWithClient(config, logger);
    this.logger = logger;
  }

  /**
   * Get basic technology information for a domain (Free API)
   */
  async getFreeLookup(domain: string): Promise<unknown> {
    this.logger.info({ msg: 'Free lookup requested', domain });

    const startTime = Date.now();

    try {
      const result = await this.client.freeLookup(domain);

      const duration = Date.now() - startTime;
      this.logger.info({
        msg: 'Free lookup completed',
        domain,
        duration,
      });

      return result;
    } catch (error) {
      this.logger.error({
        msg: 'Free lookup failed',
        domain,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Get comprehensive technology stack for a domain (Domain API)
   */
  async getDomainLookup(domain: string, options: DomainLookupOptions = {}): Promise<unknown> {
    this.logger.info({
      msg: 'Domain lookup requested',
      domain,
      options,
    });

    const startTime = Date.now();

    try {
      const result = await this.client.domainLookup(domain, options);

      const duration = Date.now() - startTime;
      this.logger.info({
        msg: 'Domain lookup completed',
        domain,
        duration,
      });

      return result;
    } catch (error) {
      this.logger.error({
        msg: 'Domain lookup failed',
        domain,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Find websites using specific technology (Lists API)
   */
  async listSites(technology: string, options: ListSitesOptions = {}): Promise<unknown> {
    this.logger.info({
      msg: 'List sites requested',
      technology,
      options,
    });

    const startTime = Date.now();

    try {
      const result = await this.client.listSites(technology, options);

      const duration = Date.now() - startTime;
      this.logger.info({
        msg: 'List sites completed',
        technology,
        duration,
      });

      return result;
    } catch (error) {
      this.logger.error({
        msg: 'List sites failed',
        technology,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.client.getCacheStats();
  }
}
