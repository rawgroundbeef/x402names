import { Hono } from 'hono';
import type { DomainRegistrar } from '../../integrations/registrar/types';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { createJobProcessor } from '../../lib/jobs/registration';
import type { DnsService } from '../../services/dns';
import { createCheckRoutes } from './check';
import { createStatusRoutes } from './status';
import { createRegisterRoutes } from './register';
import { createDnsRoutes } from './dns';

/**
 * Factory function to create domain routes with dependency injection
 */
export function createDomainRoutes(
  registrar: DomainRegistrar,
  db: BunSQLiteDatabase<any>,
  jobProcessor: ReturnType<typeof createJobProcessor>,
  dnsService: DnsService
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

  return router;
}
