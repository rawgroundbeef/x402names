import { describe, test, expect, beforeAll } from 'bun:test';
import { Hono } from 'hono';

// Set test environment before importing app modules
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ':memory:';

// Import after setting env vars
const { default: app } = await import('../../index');

describe('Health Endpoint', () => {
  test('GET /health returns 200', async () => {
    const req = new Request('http://localhost:3000/health');
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
  });

  test('GET /health returns correct shape', async () => {
    const req = new Request('http://localhost:3000/health');
    const res = await app.fetch(req);
    const data = await res.json();

    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('env');
    expect(data).toHaveProperty('database');

    expect(data.status).toBe('ok');
    expect(data.database).toBe('ok');
    expect(data.env).toBe('test');

    // Validate timestamp is valid ISO string
    const timestamp = new Date(data.timestamp);
    expect(timestamp.toISOString()).toBe(data.timestamp);
  });

  test('GET / returns API info', async () => {
    const req = new Request('http://localhost:3000/');
    const res = await app.fetch(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.name).toBe('x402names');
    expect(data).toHaveProperty('version');
  });
});
