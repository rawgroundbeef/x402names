import { Hono } from 'hono';
import type { DomainRegistrar } from '../../integrations/registrar/types';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { createCheckRoutes } from './check';
import { createStatusRoutes } from './status';

/**
 * Factory function to create domain routes with dependency injection
 */
export function createDomainRoutes(
  registrar: DomainRegistrar,
  db: BunSQLiteDatabase<any>
) {
  const router = new Hono();

  // Mount check routes at /check (POST /domains/check)
  router.route('/check', createCheckRoutes(registrar));

  // Mount status routes for GET /domains/:domain/status
  router.route('/', createStatusRoutes(registrar, db));

  return router;
}
