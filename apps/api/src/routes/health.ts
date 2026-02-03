import { Hono } from 'hono';
import { env } from '../config/env';
import { sqlite } from '../db';

const health = new Hono();

health.get('/', async (c) => {
  let databaseStatus = 'ok';

  try {
    // Test database connectivity with a simple query
    const result = sqlite.query('PRAGMA journal_mode').get();
    if (!result) {
      databaseStatus = 'error';
    }
  } catch (error) {
    databaseStatus = 'error';
  }

  const status = databaseStatus === 'ok' ? 'ok' : 'degraded';

  return c.json({
    status,
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
    database: databaseStatus,
  });
});

export default health;
