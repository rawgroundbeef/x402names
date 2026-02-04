---
phase: 06
plan: 01
subsystem: middleware
tags: [rate-limiting, security, hono, middleware]
requires: [05-03]
provides:
  - rate_limiting_middleware
  - read_endpoint_protection
affects: [06-02, 06-03]
tech-stack:
  added: [hono-rate-limiter@0.5.3]
  patterns: [sliding-window-rate-limiting, ip-based-throttling]
key-files:
  created:
    - apps/api/src/lib/middleware/rate-limit.ts
    - apps/api/src/lib/middleware/__tests__/rate-limit.test.ts
  modified:
    - apps/api/src/index.ts
    - apps/api/src/config/env.ts
    - apps/api/package.json
decisions:
  - id: HARD-01-01
    desc: 100 req/min/IP sliding window for read endpoints
    rationale: Generous limit prevents abuse while allowing legitimate high-volume reads
  - id: HARD-01-02
    desc: Paid endpoints excluded from rate limiting
    rationale: Payment is natural throttle, registration and URL updates self-limit
  - id: HARD-01-03
    desc: IP extraction respects BEHIND_PROXY env var
    rationale: Enables proper IP identification in proxy/load balancer deployments
  - id: HARD-01-04
    desc: 429 responses follow RFC 9457 with Retry-After header
    rationale: Consistent error format, machine-readable retry guidance
metrics:
  tests:
    added: 6
    total: 144
  duration: 142s
  completed: 2026-02-04
---

# Phase 6 Plan 1: Rate Limiting Middleware Summary

**One-liner:** IP-based rate limiting (100 req/min) on free read endpoints via hono-rate-limiter with RFC 9457 compliant 429 responses

## What Was Built

Added rate limiting middleware to protect free read endpoints from abuse while keeping paid endpoints (registration, URL updates) unthrottled.

**Key capabilities:**
- Per-IP rate limiting with 100 requests/minute sliding window
- Applied to all free read endpoints: health, TLDs, domain check/status/DNS, registrations
- RFC 9457 Problem Details 429 responses with `Retry-After: 60` header
- Proxy-aware IP extraction via `BEHIND_PROXY` env configuration
- Independent rate limits per IP address

**Architectural integration:**
- `createReadLimiter()` factory function creates middleware instance
- Applied via `app.use()` before route mounts in main app
- Uses existing RFC 9457 error framework established in Phase 3
- No impact on paid endpoints (register, url-update) - payment is natural throttle

## Technical Details

**Rate limiting configuration:**
- Window: 60,000ms (1 minute sliding window)
- Limit: 100 requests per IP per window
- Standard headers: `draft-6` spec (RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset)
- Key extraction: X-Forwarded-For (when behind proxy), X-Real-IP (fallback), 'unknown' (default)

**429 Response format:**
```json
{
  "type": "error:rate_limit_exceeded",
  "title": "Rate Limit Exceeded",
  "status": 429,
  "detail": "Too many requests. Please try again later."
}
```
Headers: `Retry-After: 60`

**Protected endpoints:**
- `GET /` (root)
- `GET /health/*`
- `GET /tlds/*`
- `GET /domains/check`
- `GET /domains/*/status`
- `GET /domains/*/dns`
- `GET /domains/*/dns/verify`
- `GET /registrations/*`

**Unprotected (paid) endpoints:**
- `POST /domains/register` (x402 payment required)
- `PATCH /domains/*/url` ($2.00 USDC payment required)

## Decisions Made

1. **Generous 100 req/min limit** - Allows legitimate high-volume checks while preventing abuse
2. **Per-IP only, no per-wallet bucketing** - Simpler implementation, sufficient for current scale
3. **Paid endpoints excluded** - Payment mechanism is natural rate limit, no additional throttling needed
4. **No proactive quota headers** - Only standard draft-6 headers, no X-RateLimit-Remaining on normal responses
5. **Sliding window implementation** - Smoother rate limiting than fixed window, prevents burst at window edges

## Testing Coverage

**New tests (6):**
- Middleware factory function validation
- Requests under limit (successful)
- 101st request returns 429 with RFC 9457 format
- Retry-After header present on 429
- Independent rate limits per IP
- Fallback to 'unknown' when no IP headers

**Integration verification:**
- All 138 existing tests still pass
- Rate limiter applied before route mounts
- No interference with existing error handling
- 429 responses properly formatted via custom handler

## Deviations from Plan

None - plan executed exactly as written.

## Dependencies

**Added:**
- hono-rate-limiter@0.5.3 - Rate limiting middleware for Hono framework

**Relies on (from previous phases):**
- Phase 3 RFC 9457 error framework (`ProblemDetails` interface)
- Phase 5 endpoint structure (health, TLDs, domains, registrations)

## Next Phase Readiness

**Ready for Phase 6 Plan 2:**
- Rate limiting infrastructure in place and tested
- Error response format consistent (RFC 9457)
- IP extraction logic ready for proxy deployments
- Can build on this for input validation (Plan 2) and error documentation (Plan 3)

**No blockers.** Rate limiting is operational and well-tested.

## Files Modified

**Created:**
- `apps/api/src/lib/middleware/rate-limit.ts` - Rate limiting middleware factory (50 lines)
- `apps/api/src/lib/middleware/__tests__/rate-limit.test.ts` - Comprehensive tests (129 lines)

**Modified:**
- `apps/api/src/index.ts` - Import and apply rate limiter to read endpoints
- `apps/api/src/config/env.ts` - Add BEHIND_PROXY boolean env var
- `apps/api/package.json` - Add hono-rate-limiter dependency

## Commits

- `9af8105` - feat(06-01): add rate limiting middleware with hono-rate-limiter
- `73422f0` - feat(06-01): apply rate limiter to free read endpoints

## Performance Notes

**Execution:**
- Duration: 142 seconds (2.4 minutes)
- Tests: 144 total (6 new, 138 existing)
- All tests passing

**Runtime impact:**
- Minimal overhead: IP extraction + counter check per request
- Memory: In-memory store per IP (cleaned up after window expires)
- No database queries or external dependencies
