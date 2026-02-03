import { Hono } from 'hono';
import { env } from './config/env';
import { sqlite } from './db';
import health from './routes/health';

const app = new Hono();

// Mount health check route
app.route('/health', health);

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
