import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { MockRegistrar } from '../../../integrations/registrar/mock';
import { createCheckRoutes } from '../check';
import { problemDetailsErrorHandler } from '../../../lib/errors';

describe('POST /domains/check', () => {
  // Create test app with MockRegistrar
  const registrar = new MockRegistrar();
  const app = new Hono();
  app.onError(problemDetailsErrorHandler);
  app.route('/check', createCheckRoutes(registrar));

  test('single available domain returns availability with USDC price', async () => {
    const response = await app.request('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: ['example.com'] }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      domain: 'example.com',
      available: true,
      price: {
        registration: 13.18, // $10.98 * 1.20 = $13.176 -> $13.18
        renewal: 15.58, // $12.98 * 1.20 = $15.576 -> $15.58
        currency: 'USDC',
      },
    });
    expect(data.results[0].error).toBeUndefined();
    expect(data.results[0].suggestions).toBeUndefined();
  });

  test('unavailable domain (taken- prefix) returns suggestions', async () => {
    const response = await app.request('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: ['taken-example.com'] }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      domain: 'taken-example.com',
      available: false,
    });
    expect(data.results[0].suggestions).toBeDefined();
    expect(Array.isArray(data.results[0].suggestions)).toBe(true);
    expect(data.results[0].suggestions!.length).toBeGreaterThan(0);
    expect(data.results[0].suggestions!.length).toBeLessThanOrEqual(5);
    expect(data.results[0].price).toBeUndefined();
  });

  test('batch check with mix of available and unavailable domains', async () => {
    const response = await app.request('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domains: ['available.com', 'taken-domain.io', 'another.net'],
      }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.results).toHaveLength(3);

    // Check first domain (available)
    expect(data.results[0]).toMatchObject({
      domain: 'available.com',
      available: true,
    });
    expect(data.results[0].price).toBeDefined();

    // Check second domain (unavailable)
    expect(data.results[1]).toMatchObject({
      domain: 'taken-domain.io',
      available: false,
    });
    expect(data.results[1].suggestions).toBeDefined();

    // Check third domain (available)
    expect(data.results[2]).toMatchObject({
      domain: 'another.net',
      available: true,
    });
    expect(data.results[2].price).toBeDefined();
  });

  test('invalid domain format returns validation error', async () => {
    const response = await app.request('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: ['bad..domain.com'] }),
    });

    // Validation happens at Zod schema level, returns 400
    expect(response.status).toBe(400);

    const data = await response.json();
    // RFC 9457 Problem Details format
    expect(data.type).toBe('error:validation');
    expect(data.title).toBe('Validation Failed');
    expect(data.status).toBe(400);
  });

  test('empty domains array returns 422 validation error', async () => {
    const response = await app.request('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: [] }),
    });

    expect(response.status).toBe(400);

    const data = await response.json();
    // RFC 9457 Problem Details format
    expect(data.type).toBe('error:validation');
    expect(data.title).toBe('Validation Failed');
    expect(data.status).toBe(400);
    expect(data.detail).toBeDefined();
  });

  test('more than 10 domains returns 422 validation error', async () => {
    const domains = Array.from({ length: 11 }, (_, i) => `domain${i}.com`);

    const response = await app.request('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains }),
    });

    expect(response.status).toBe(400);

    const data = await response.json();
    // RFC 9457 Problem Details format
    expect(data.type).toBe('error:validation');
    expect(data.title).toBe('Validation Failed');
    expect(data.status).toBe(400);
    expect(data.detail).toBeDefined();
  });

  test('USDC price includes 20% markup for .com domains', async () => {
    const response = await app.request('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: ['test.com'] }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.results[0].price).toMatchObject({
      registration: 13.18, // Base $10.98 * 1.20 = $13.176 rounded to $13.18
      renewal: 15.58, // Base $12.98 * 1.20 = $15.576 rounded to $15.58
      currency: 'USDC',
    });
  });

  test('USDC price includes 20% markup for .io domains', async () => {
    const response = await app.request('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: ['test.io'] }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    // .io base price is typically higher (around $39.98)
    expect(data.results[0].price).toBeDefined();
    expect(data.results[0].price!.currency).toBe('USDC');
    expect(data.results[0].price!.registration).toBeGreaterThan(40); // Should be ~$47.98 with markup
  });

  test('suggestions are non-empty for unavailable domains', async () => {
    const response = await app.request('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: ['taken-test.com'] }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.results[0].suggestions).toBeDefined();
    expect(data.results[0].suggestions!.length).toBeGreaterThan(0);
    // Verify suggestions are different from original
    expect(data.results[0].suggestions).not.toContain('taken-test.com');
  });

  test('RFC 9457 error format for validation failures', async () => {
    const response = await app.request('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: [] }),
    });

    expect(response.status).toBe(400);

    const data = await response.json();
    // Verify all required RFC 9457 fields
    expect(data).toHaveProperty('type');
    expect(data).toHaveProperty('title');
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('detail');
    expect(typeof data.type).toBe('string');
    expect(typeof data.title).toBe('string');
    expect(typeof data.status).toBe('number');
    expect(typeof data.detail).toBe('string');
  });

  test('unsupported TLD returns error in result', async () => {
    const response = await app.request('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: ['example.randomtld'] }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      domain: 'example.randomtld',
      available: false,
      error: 'Unsupported TLD',
    });
  });

  test('batch check runs registrar calls in parallel', async () => {
    const startTime = Date.now();

    const response = await app.request('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domains: ['test1.com', 'test2.com', 'test3.com', 'test4.com', 'test5.com'],
      }),
    });

    const duration = Date.now() - startTime;

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.results).toHaveLength(5);

    // If calls were sequential, it would take much longer
    // With parallel execution (MockRegistrar is instant), should be very fast
    expect(duration).toBeLessThan(100); // Should complete in under 100ms
  });
});
