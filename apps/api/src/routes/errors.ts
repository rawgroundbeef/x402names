import { Hono } from 'hono';
import catalog from '../docs/error-catalog.json';

const errors = new Hono();

/**
 * GET /errors
 * Returns the complete error catalog for agent discovery
 */
errors.get('/', (c) => {
  return c.json(catalog);
});

/**
 * GET /errors/:code
 * Returns a single error entry by code (case-insensitive)
 */
errors.get('/:code', (c) => {
  const code = c.req.param('code').toUpperCase();

  const error = catalog.errors.find(e => e.code === code);

  if (!error) {
    return c.json({
      type: 'error:not_found',
      title: 'Error Code Not Found',
      status: 404,
      detail: `Error code '${code}' not found in catalog`
    }, 404);
  }

  return c.json(error);
});

export default errors;
