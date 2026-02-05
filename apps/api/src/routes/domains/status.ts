import { Hono } from 'hono';
import type { DomainRegistrar, RegistrarUnavailable } from '../../integrations/registrar/types';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { validateDomain } from '../../lib/validation/domain';
import { createProblemResponse } from '../../lib/errors';
import { eq } from 'drizzle-orm';
import { domains } from '../../db/schema';
import { parse } from 'tldts';

/**
 * Domain status response
 */
interface DomainStatusResponse {
  domain: string;
  status: 'pending' | 'paid' | 'registered' | 'live' | 'failed' | 'available';
  ownerWallet?: string | null;
  targetUrl?: string | null;
  registeredAt?: string | null;
  expiresAt?: string | null;
  lastUpdated?: string | null;
}

/**
 * Factory function to create status routes with dependency injection
 */
export function createStatusRoutes(
  registrar: DomainRegistrar,
  db: BunSQLiteDatabase<any>
) {
  const router = new Hono();

  /**
   * GET /:domain/status
   * Get registration status for a domain
   */
  router.get('/:domain/status', async (c) => {
    const domainParam = c.req.param('domain');

    // Validate domain format
    const validation = validateDomain(domainParam);
    if (!validation.valid) {
      return createProblemResponse(
        c,
        400,
        'error:validation',
        'Invalid Domain',
        validation.error || 'Invalid domain format'
      );
    }

    const { sld, tld } = validation;

    if (!sld || !tld) {
      return createProblemResponse(
        c,
        400,
        'error:validation',
        'Invalid Domain',
        'Could not parse domain components'
      );
    }

    try {
      // First check local database (name stores full domain, e.g. "sentientbeef.xyz")
      const fullDomain = `${sld}.${tld}`;
      const domainRecord = await db
        .select()
        .from(domains)
        .where(eq(domains.name, fullDomain))
        .get();

      if (domainRecord) {
        // Domain is in our system - return full info
        const registeredAt = domainRecord.createdAt
          ? new Date(domainRecord.createdAt).toISOString()
          : null;

        // Calculate expiration (1 year from registration)
        const expiresAt = domainRecord.createdAt
          ? new Date(
              new Date(domainRecord.createdAt).getTime() + 365 * 24 * 60 * 60 * 1000
            ).toISOString()
          : null;

        const lastUpdated = domainRecord.updatedAt
          ? new Date(domainRecord.updatedAt).toISOString()
          : null;

        const response: DomainStatusResponse = {
          domain: `${sld}.${tld}`,
          status: domainRecord.status,
          ownerWallet: domainRecord.ownerWallet,
          targetUrl: domainRecord.targetUrl,
          registeredAt,
          expiresAt,
          lastUpdated,
        };

        return c.json(response);
      }

      // Not in our database - check registrar
      const registrarStatus = await registrar.getStatus(`${sld}.${tld}`);

      if (registrarStatus.status === 'active') {
        // Registered elsewhere (not through our system)
        const response: DomainStatusResponse = {
          domain: `${sld}.${tld}`,
          status: 'registered',
          ownerWallet: null,
          targetUrl: null,
          registeredAt: registrarStatus.createdAt
            ? registrarStatus.createdAt.toISOString()
            : null,
          expiresAt: registrarStatus.expiresAt
            ? registrarStatus.expiresAt.toISOString()
            : null,
          lastUpdated: null,
        };

        return c.json(response);
      } else {
        // Domain is available
        const response: DomainStatusResponse = {
          domain: `${sld}.${tld}`,
          status: 'available',
          ownerWallet: null,
          targetUrl: null,
          registeredAt: null,
          expiresAt: null,
          lastUpdated: null,
        };

        return c.json(response);
      }
    } catch (error) {
      // Handle registrar errors
      if (error instanceof Error && error.name === 'RegistrarUnavailable') {
        return createProblemResponse(
          c,
          503,
          'error:registrar_unavailable',
          'Registrar Unavailable',
          'Domain registrar is temporarily unavailable'
        );
      }

      // Re-throw unknown errors to be caught by global error handler
      throw error;
    }
  });

  return router;
}
