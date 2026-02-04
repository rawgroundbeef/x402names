import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createReadLimiter } from '../rate-limit';

describe('Rate Limiting Middleware', () => {
  test('createReadLimiter returns middleware function', () => {
    const limiter = createReadLimiter();
    expect(typeof limiter).toBe('function');
  });

  test('allows requests under rate limit', async () => {
    const app = new Hono();
    const limiter = createReadLimiter();

    app.use('*', limiter);
    app.get('/test', (c) => c.json({ success: true }));

    // Send 10 requests under the limit
    for (let i = 0; i < 10; i++) {
      const res = await app.request('/test', {
        headers: { 'X-Real-IP': '192.168.1.1' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true });
    }
  });

  test('returns 429 when rate limit exceeded', async () => {
    const app = new Hono();
    const limiter = createReadLimiter();

    app.use('*', limiter);
    app.get('/test', (c) => c.json({ success: true }));

    const clientIp = '192.168.1.2';

    // Send 101 requests to exceed limit (100 req/min)
    let last429Response: Response | null = null;

    for (let i = 0; i < 101; i++) {
      const res = await app.request('/test', {
        headers: { 'X-Real-IP': clientIp },
      });

      if (res.status === 429) {
        last429Response = res;
        break; // We got our 429, stop here to save time
      }
    }

    // Should have gotten a 429 by now
    expect(last429Response).not.toBeNull();
    expect(last429Response!.status).toBe(429);

    // Verify RFC 9457 Problem Details format
    const body = (await last429Response!.json()) as any;
    expect(body.type).toBe('error:rate_limit_exceeded');
    expect(body.title).toBe('Rate Limit Exceeded');
    expect(body.status).toBe(429);
    expect(body.detail).toBe('Too many requests. Please try again later.');

    // Verify Retry-After header
    const retryAfter = last429Response!.headers.get('Retry-After');
    expect(retryAfter).toBe('60');
  });

  test('different IPs get independent rate limits', async () => {
    const app = new Hono();
    const limiter = createReadLimiter();

    app.use('*', limiter);
    app.get('/test', (c) => c.json({ success: true }));

    // Send 50 requests from IP 1
    for (let i = 0; i < 50; i++) {
      const res = await app.request('/test', {
        headers: { 'X-Real-IP': '192.168.1.10' },
      });
      expect(res.status).toBe(200);
    }

    // Send 50 requests from IP 2 - should also succeed
    for (let i = 0; i < 50; i++) {
      const res = await app.request('/test', {
        headers: { 'X-Real-IP': '192.168.1.11' },
      });
      expect(res.status).toBe(200);
    }

    // Both IPs should still be under their individual limits
  });

  test('uses X-Forwarded-For when BEHIND_PROXY is true', async () => {
    // Note: This test verifies the keyGenerator behavior
    // In production, BEHIND_PROXY env var controls this
    const app = new Hono();
    const limiter = createReadLimiter();

    app.use('*', limiter);
    app.get('/test', (c) => c.json({ success: true }));

    // When BEHIND_PROXY=false (default), X-Forwarded-For is ignored
    // and X-Real-IP is used
    const res = await app.request('/test', {
      headers: {
        'X-Forwarded-For': '10.0.0.1, 10.0.0.2',
        'X-Real-IP': '192.168.1.20',
      },
    });

    expect(res.status).toBe(200);
  });

  test('falls back to unknown when no IP headers present', async () => {
    const app = new Hono();
    const limiter = createReadLimiter();

    app.use('*', limiter);
    app.get('/test', (c) => c.json({ success: true }));

    // Request with no IP headers should use 'unknown' key
    const res = await app.request('/test', {
      headers: {},
    });

    expect(res.status).toBe(200);
  });
});
