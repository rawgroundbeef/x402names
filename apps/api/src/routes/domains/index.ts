import { Hono } from 'hono';
import type { DomainRegistrar } from '../../integrations/registrar/types';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { createJobProcessor } from '../../lib/jobs/registration';
import type { DnsService } from '../../services/dns';
import type { DomainCache } from '../../redirect/cache';
import type { ContentCache } from '../../redirect/content-cache';
import { createCheckRoutes } from './check';
import { createStatusRoutes } from './status';
import { createRegisterRoutes } from './register';
import { createDnsRoutes } from './dns';
import { createDnsConfigureRoutes } from './dns-configure';
import { createUrlUpdateRoutes } from './url-update';
import { createRenewRoutes } from './renew';
import { createTransferRoutes } from './transfer';

/**
 * Factory function to create domain routes with dependency injection
 */
export function createDomainRoutes(
  registrar: DomainRegistrar,
  db: BunSQLiteDatabase<any>,
  jobProcessor: ReturnType<typeof createJobProcessor>,
  dnsService: DnsService,
  domainCache: DomainCache,
  contentCache: ContentCache
) {
  const router = new Hono();

  // Mount check routes at /check (POST /domains/check)
  router.route('/check', createCheckRoutes(registrar));

  // Mount status routes for GET /domains/:domain/status
  router.route('/', createStatusRoutes(registrar, db));

  // Mount register routes at /register (POST /domains/register)
  router.route('/register', createRegisterRoutes(registrar, db, jobProcessor));

  // Mount DNS routes for GET /domains/:name/dns and /domains/:name/dns/verify
  router.route('/', createDnsRoutes(db, dnsService));

  // Mount URL update routes for PATCH /domains/:name/url
  router.route('/', createUrlUpdateRoutes(db, domainCache, contentCache));

  // Mount DNS reconfigure routes for POST /domains/:name/dns/configure
  router.route('/', createDnsConfigureRoutes(db, dnsService, domainCache, contentCache));

  // Mount renewal routes for POST /domains/:name/renew
  router.route('/', createRenewRoutes(registrar, db));

  // Mount transfer routes for POST /domains/:name/transfer
  router.route('/', createTransferRoutes(registrar, db));

  return router;
}
