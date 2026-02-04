import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import errors from '../errors';

describe('Error Catalog Routes', () => {
  const app = new Hono();
  app.route('/errors', errors);

  describe('GET /errors', () => {
    it('should return 200 with full error catalog', async () => {
      const res = await app.request('/errors');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('categories');
      expect(data).toHaveProperty('errors');
    });

    it('should have 26+ documented errors', async () => {
      const res = await app.request('/errors');
      const data = await res.json();

      expect(Array.isArray(data.errors)).toBe(true);
      expect(data.errors.length).toBeGreaterThanOrEqual(26);
    });

    it('should have all required fields in each error entry', async () => {
      const res = await app.request('/errors');
      const data = await res.json();

      for (const error of data.errors) {
        expect(error).toHaveProperty('code');
        expect(error).toHaveProperty('type');
        expect(error).toHaveProperty('status');
        expect(error).toHaveProperty('title');
        expect(error).toHaveProperty('description');
        expect(error).toHaveProperty('category');
        expect(error).toHaveProperty('retryable');
        expect(error).toHaveProperty('example');

        // Verify retryable is boolean
        expect(typeof error.retryable).toBe('boolean');

        // Verify example has required fields
        expect(error.example).toHaveProperty('type');
        expect(error.example).toHaveProperty('title');
        expect(error.example).toHaveProperty('status');
      }
    });

    it('should have all defined categories', async () => {
      const res = await app.request('/errors');
      const data = await res.json();

      expect(data.categories).toContain('rate_limiting');
      expect(data.categories).toContain('validation');
      expect(data.categories).toContain('payment');
      expect(data.categories).toContain('registration');
      expect(data.categories).toContain('server');
    });

    it('should have at least one error in each category', async () => {
      const res = await app.request('/errors');
      const data = await res.json();

      const categoryCounts: Record<string, number> = {};
      for (const error of data.errors) {
        categoryCounts[error.category] = (categoryCounts[error.category] || 0) + 1;
      }

      for (const category of data.categories) {
        expect(categoryCounts[category]).toBeGreaterThan(0);
      }
    });

    it('should have valid HTTP status codes (400-599)', async () => {
      const res = await app.request('/errors');
      const data = await res.json();

      for (const error of data.errors) {
        expect(error.status).toBeGreaterThanOrEqual(400);
        expect(error.status).toBeLessThan(600);
      }
    });
  });

  describe('GET /errors/:code', () => {
    it('should return RATE_LIMIT_EXCEEDED error details', async () => {
      const res = await app.request('/errors/RATE_LIMIT_EXCEEDED');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(data.status).toBe(429);
      expect(data.category).toBe('rate_limiting');
      expect(data.retryable).toBe(true);
      expect(data).toHaveProperty('responseHeaders');
      expect(data.responseHeaders).toHaveProperty('Retry-After');
    });

    it('should return DOMAIN_INVALID_FORMAT error details', async () => {
      const res = await app.request('/errors/DOMAIN_INVALID_FORMAT');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.code).toBe('DOMAIN_INVALID_FORMAT');
      expect(data.status).toBe(400);
      expect(data.category).toBe('validation');
      expect(data.retryable).toBe(false);
    });

    it('should return SERVER_ERROR details', async () => {
      const res = await app.request('/errors/SERVER_ERROR');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.code).toBe('SERVER_ERROR');
      expect(data.status).toBe(500);
      expect(data.category).toBe('server');
      expect(data.retryable).toBe(true);
    });

    it('should return PAYMENT_REQUIRED details', async () => {
      const res = await app.request('/errors/PAYMENT_REQUIRED');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.code).toBe('PAYMENT_REQUIRED');
      expect(data.status).toBe(402);
      expect(data.category).toBe('payment');
      expect(data.retryable).toBe(true);
    });

    it('should return INSUFFICIENT_PAYMENT details', async () => {
      const res = await app.request('/errors/INSUFFICIENT_PAYMENT');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.code).toBe('INSUFFICIENT_PAYMENT');
      expect(data.status).toBe(402);
      expect(data.category).toBe('payment');
      expect(data.retryable).toBe(true);
    });

    it('should return PAYMENT_ALREADY_USED details', async () => {
      const res = await app.request('/errors/PAYMENT_ALREADY_USED');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.code).toBe('PAYMENT_ALREADY_USED');
      expect(data.status).toBe(409);
      expect(data.category).toBe('payment');
      expect(data.retryable).toBe(false);
    });

    it('should return DOMAIN_UNAVAILABLE details', async () => {
      const res = await app.request('/errors/DOMAIN_UNAVAILABLE');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.code).toBe('DOMAIN_UNAVAILABLE');
      expect(data.status).toBe(409);
      expect(data.category).toBe('registration');
      expect(data.retryable).toBe(false);
    });

    it('should return NOT_DOMAIN_OWNER details', async () => {
      const res = await app.request('/errors/NOT_DOMAIN_OWNER');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.code).toBe('NOT_DOMAIN_OWNER');
      expect(data.status).toBe(403);
      expect(data.category).toBe('registration');
      expect(data.retryable).toBe(false);
    });

    it('should return URL_SCHEME_UNSUPPORTED details', async () => {
      const res = await app.request('/errors/URL_SCHEME_UNSUPPORTED');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.code).toBe('URL_SCHEME_UNSUPPORTED');
      expect(data.status).toBe(400);
      expect(data.category).toBe('validation');
      expect(data.retryable).toBe(false);
    });

    it('should return URL_PRIVATE_ADDRESS details', async () => {
      const res = await app.request('/errors/URL_PRIVATE_ADDRESS');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.code).toBe('URL_PRIVATE_ADDRESS');
      expect(data.status).toBe(400);
      expect(data.category).toBe('validation');
      expect(data.retryable).toBe(false);
    });

    it('should return REGISTRAR_UNAVAILABLE details', async () => {
      const res = await app.request('/errors/REGISTRAR_UNAVAILABLE');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.code).toBe('REGISTRAR_UNAVAILABLE');
      expect(data.status).toBe(503);
      expect(data.category).toBe('server');
      expect(data.retryable).toBe(true);
    });

    it('should be case-insensitive', async () => {
      const upperRes = await app.request('/errors/RATE_LIMIT_EXCEEDED');
      const lowerRes = await app.request('/errors/rate_limit_exceeded');
      const mixedRes = await app.request('/errors/Rate_Limit_Exceeded');

      expect(upperRes.status).toBe(200);
      expect(lowerRes.status).toBe(200);
      expect(mixedRes.status).toBe(200);

      const upperData = await upperRes.json();
      const lowerData = await lowerRes.json();
      const mixedData = await mixedRes.json();

      expect(upperData.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(lowerData.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(mixedData.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('should return 404 for non-existent error code', async () => {
      const res = await app.request('/errors/NONEXISTENT_CODE');
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.type).toBe('error:not_found');
      expect(data.title).toBe('Error Code Not Found');
    });
  });
});
