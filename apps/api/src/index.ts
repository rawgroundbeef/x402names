import { Hono } from 'hono';
import { env } from './config/env';
import { sqlite, db } from './db';
import health from './routes/health';
import tlds from './routes/tlds';
import errors from './routes/errors';
import { problemDetailsErrorHandler } from './lib/errors';
import { MockRegistrar } from './integrations/registrar/mock';
import { NamecheapRegistrar } from './integrations/registrar/namecheap';
import { createDomainRoutes } from './routes/domains';
import { createRegistrationRoutes } from './routes/registrations';
import { createJobProcessor } from './lib/jobs/registration';
import { clearAllJobs } from './lib/jobs/queue';
import { createRedirectApp } from './redirect/server';
import { DomainCache } from './redirect/cache';
import { ContentCache } from './redirect/content-cache';
import { createDnsService } from './services/dns';
import { createReadLimiter } from './lib/middleware/rate-limit';

const app = new Hono();

// Register global error handler
app.onError(problemDetailsErrorHandler);

// Create registrar instance (Namecheap when configured, otherwise MockRegistrar)
const registrar = env.NAMECHEAP_API_USER
  ? new NamecheapRegistrar(
      env.NAMECHEAP_API_USER,
      env.NAMECHEAP_API_KEY,
      env.NAMECHEAP_CLIENT_IP,
      env.NAMECHEAP_SANDBOX
    )
  : new MockRegistrar();

// Create DNS service
const dnsService = createDnsService(registrar, env.REDIRECT_SERVER_IP);

// Create job processor with DNS service
const jobProcessor = createJobProcessor(registrar, db, dnsService);

// Create domain cache, content cache, and redirect server
export const domainCache = new DomainCache();
export const contentCache = new ContentCache();
const redirectApp = createRedirectApp(db, domainCache, contentCache);

// Create rate limiter for free read endpoints
const readLimiter = createReadLimiter();

// Apply rate limiting to free read endpoints (before route mounts)
app.use('/', readLimiter); // Root endpoint
app.use('/health/*', readLimiter); // Health check
app.use('/tlds/*', readLimiter); // TLD listing/pricing
app.use('/errors/*', readLimiter); // Error catalog
app.use('/domains/check', readLimiter); // Availability check
app.use('/domains/*/status', readLimiter); // Domain status
app.use('/domains/*/dns', readLimiter); // DNS info
app.use('/domains/*/dns/verify', readLimiter); // DNS verify
app.use('/registrations/*', readLimiter); // Registration status polling

// Mount health check route
app.route('/health', health);

// Mount TLD routes
app.route('/tlds', tlds);

// Mount error catalog route
app.route('/errors', errors);

// Mount domain routes
app.route('/domains', createDomainRoutes(registrar, db, jobProcessor, dnsService, domainCache, contentCache));

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
