import { Hono } from 'hono';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { createStatusRoutes } from './status';

/**
 * Factory function to create registration routes
 */
export function createRegistrationRoutes(db: BunSQLiteDatabase<any>) {
  const router = new Hono();
  router.route('/', createStatusRoutes(db));
  return router;
}
