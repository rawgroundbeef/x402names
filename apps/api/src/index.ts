import { Hono } from 'hono';
import { env } from './config/env';
import { sqlite, db } from './db';
import health from './routes/health';
import tlds from './routes/tlds';
import { problemDetailsErrorHandler } from './lib/errors';
import { MockRegistrar } from './integrations/registrar/mock';
import { createDomainRoutes } from './routes/domains';

const app = new Hono();

// Register global error handler
app.onError(problemDetailsErrorHandler);

// Create registrar instance (MockRegistrar for development)
const registrar = new MockRegistrar();

// Mount health check route
app.route('/health', health);

// Mount TLD routes
app.route('/tlds', tlds);

// Mount domain routes
app.route('/domains', createDomainRoutes(registrar, db));

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'x402names',
    version: '0.1.0',
  });
});

// Graceful shutdown handlers
const shutdown = () => {
  console.log('Shutting down gracefully...');
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
