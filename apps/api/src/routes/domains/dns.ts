/**
 * DNS routes for domain configuration and verification
 */

import { Hono } from 'hono';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { DnsService } from '../../services/dns';
import { eq } from 'drizzle-orm';
import { domains } from '../../db/schema';
import { createProblemResponse } from '../../lib/errors';

/**
 * Factory function to create DNS routes with dependency injection
 */
export function createDnsRoutes(
  db: BunSQLiteDatabase<any>,
  dnsService: DnsService
) {
  const router = new Hono();

  /**
   * GET /:name/dns
   * Get DNS configuration info for a domain
   */
  router.get('/:name/dns', async (c) => {
    const domainName = c.req.param('name');

    // Look up domain in database
    const domain = db
      .select()
      .from(domains)
      .where(eq(domains.name, domainName))
      .get();

    if (!domain) {
      return createProblemResponse(
        c,
        404,
        'error:not_found',
        'Domain Not Found',
        `Domain ${domainName} is not registered in this system`
      );
    }

    // Get DNS info from service
    const dnsInfo = dnsService.getDnsInfo(domainName);

    // Return DNS info with domain status
    return c.json({
      ...dnsInfo,
      domainStatus: domain.status,
    });
  });

  /**
   * GET /:name/dns/verify
   * Verify DNS propagation for a domain
   */
  router.get('/:name/dns/verify', async (c) => {
    const domainName = c.req.param('name');

    // Look up domain in database
    const domain = db
      .select()
      .from(domains)
      .where(eq(domains.name, domainName))
      .get();

    if (!domain) {
      return createProblemResponse(
        c,
        404,
        'error:not_found',
        'Domain Not Found',
        `Domain ${domainName} is not registered in this system`
      );
    }

    // Verify DNS
    const verificationResult = await dnsService.verifyDns(domainName);

    return c.json(verificationResult);
  });

  return router;
}
