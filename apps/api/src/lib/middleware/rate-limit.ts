import { rateLimiter } from 'hono-rate-limiter';
import { env } from '../../config/env';
import type { Context } from 'hono';

/**
 * Creates rate limiter middleware for free read endpoints
 *
 * Configuration:
 * - 100 requests per minute per IP (sliding window)
 * - Returns RFC 9457 Problem Details on 429
 * - Includes Retry-After header with wait time
 * - Extracts client IP based on BEHIND_PROXY setting
 */
export function createReadLimiter() {
  return rateLimiter({
    windowMs: 60 * 1000, // 1 minute sliding window
    limit: 100, // 100 requests per minute per IP
    standardHeaders: 'draft-6', // RateLimit-* headers per draft-6 spec

    // Extract client IP based on proxy configuration
    keyGenerator: (c: Context) => {
      if (env.BEHIND_PROXY) {
        // Behind proxy: use first entry from X-Forwarded-For
        const forwardedFor = c.req.header('X-Forwarded-For');
        if (forwardedFor) {
          const firstIp = forwardedFor.split(',')[0]?.trim();
          if (firstIp) return firstIp;
        }
      }

      // Fall back to X-Real-IP, then 'unknown'
      return c.req.header('X-Real-IP') || 'unknown';
    },

    // Custom 429 handler returning RFC 9457 Problem Details
    handler: (c: Context) => {
      const problem = {
        type: 'error:rate_limit_exceeded',
        title: 'Rate Limit Exceeded',
        status: 429,
        detail: 'Too many requests. Please try again later.',
      };

      // Add Retry-After header (60 seconds = window duration)
      c.header('Retry-After', '60');

      return c.json(problem, 429);
    },
  });
}
