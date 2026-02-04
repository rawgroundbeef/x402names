import { Hono } from 'hono';
import { env } from './config/env';
import { sqlite, db } from './db';
import health from './routes/health';
import tlds from './routes/tlds';
import { problemDetailsErrorHandler } from './lib/errors';
import { MockRegistrar } from './integrations/registrar/mock';
import { createDomainRoutes } from './routes/domains';
import { createRegistrationRoutes } from './routes/registrations';
import { createJobProcessor } from './lib/jobs/registration';
import { clearAllJobs } from './lib/jobs/queue';
import { createRedirectApp } from './redirect/server';
import { DomainCache } from './redirect/cache';

const app = new Hono();

// Register global error handler
app.onError(problemDetailsErrorHandler);

// Create registrar instance (MockRegistrar for development)
const registrar = new MockRegistrar();

// Create job processor
const jobProcessor = createJobProcessor(registrar, db);

// Create domain cache and redirect server
export const domainCache = new DomainCache();
const redirectApp = createRedirectApp(db, domainCache);

// Mount health check route
app.route('/health', health);

// Mount TLD routes
app.route('/tlds', tlds);

// Mount domain routes
app.route('/domains', createDomainRoutes(registrar, db, jobProcessor));

// Mount registration routes
app.route('/registrations', createRegistrationRoutes(db));

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'x402names',
    version: '0.1.0',
  });
});

// Start redirect server (only in non-test environments)
let redirectServer: ReturnType<typeof Bun.serve> | undefined;
if (env.NODE_ENV !== 'test') {
  redirectServer = Bun.serve({
    port: env.REDIRECT_PORT,
    fetch: redirectApp.fetch,
  });

  console.log(`x402names redirect server running on port ${env.REDIRECT_PORT}`);
}

// Graceful shutdown handlers
const shutdown = () => {
  console.log('Shutting down gracefully...');
  clearAllJobs();
  if (redirectServer && typeof redirectServer.stop === 'function') {
    redirectServer.stop();
  }
  sqlite.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Log startup
console.log(`x402names API running on port ${env.PORT}`);

// Export for Bun.serve
export default {
  port: env.PORT,
  fetch: app.fetch,
};
