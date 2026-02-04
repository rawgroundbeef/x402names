---
phase: 05-url-forwarding
plan: 01
subsystem: redirect-server
tags: [hono, caching, http-redirects, host-routing, domain-forwarding]
requires: [04-02-registration-flow]
provides: [redirect-server, domain-cache, acme-placeholder]
affects: [05-03-url-updates, 05-04-ssl-provisioning]
tech-stack:
  added: [node-cache]
  patterns: [host-based-routing, in-memory-caching, ttl-cache]
key-files:
  created:
    - apps/api/src/redirect/cache.ts
    - apps/api/src/redirect/server.ts
    - apps/api/src/redirect/__tests__/redirect.test.ts
  modified:
    - apps/api/src/config/env.ts
    - apps/api/src/index.ts
    - apps/api/package.json
decisions:
  - choice: In-memory cache with 300s TTL for domain-to-URL mappings
    rationale: Fast redirect performance with acceptable propagation delay for URL updates
    tradeoff: 5-minute delay for URL changes to take effect vs instant DB lookup on every request
  - choice: Host-based routing via Hono getPath function
    rationale: Single app instance handles multiple domains by extracting host from request
    tradeoff: Custom routing logic vs standard path-based routing
  - choice: Separate redirect server on port 3001
    rationale: Isolate public redirect traffic from authenticated API, different scaling needs
    tradeoff: Two server processes vs single unified server
  - choice: Middleware pattern for domain handler with ACME check inside
    rationale: Hono's wildcard routing makes specific ACME route unreachable, check must happen in handler
    tradeoff: Inline check vs separate route
metrics:
  duration: 270
  completed: 2026-02-04
---

# Phase 5 Plan 01: Multi-Domain Redirect Server Summary

**One-liner:** Host-based redirect server with 301 forwarding, in-memory cache, and page variants for configured/unconfigured/unknown domains

## What Was Built

Created a production-ready multi-domain redirect server that:

- Routes requests by hostname using Hono's custom `getPath` function
- Performs 301 permanent redirects for domains with targetUrl, preserving full path and query string
- Caches domain-to-URL mappings in memory (300s TTL) to minimize database queries
- Shows holding page for registered domains without targetUrl configured
- Shows landing page with registration CTA for unknown domains
- Provides ACME challenge route placeholder for future SSL provisioning (Phase 5 Plan 04)
- Strips port from Host header for development compatibility
- Runs on separate configurable port (default 3001) alongside API server (port 3000)
- Only starts in non-test environments to prevent port conflicts during testing

### Key Components

**DomainCache** (`apps/api/src/redirect/cache.ts`):
- Wraps node-cache with clean interface for domain-to-URL storage
- Configurable TTL (default 300s) and automatic expiration checking (60s interval)
- Methods: `get`, `set`, `del`, `flush`
- Exported from main server for cache invalidation in Plan 03

**Redirect Server** (`apps/api/src/redirect/server.ts`):
- Hono app factory accepting database and cache instances
- Custom `getPath` transforms requests to `/{domain}{pathname}` format for host-based routing
- Middleware pattern handles all domain requests after ACME check
- Extracts domain from path, checks cache first, falls back to database
- Builds redirect URL preserving original path and query parameters
- Differentiated HTML responses for three domain states:
  - Configured: 301 redirect to targetUrl
  - Unconfigured: 200 holding page (purple gradient, "not configured yet")
  - Unknown: 200 landing page (blue gradient, "available for registration")

**Integration** (`apps/api/src/index.ts`):
- DomainCache instantiated and exported for Plan 03 cache invalidation
- Redirect server started via Bun.serve on REDIRECT_PORT (only in non-test mode)
- Shutdown handler updated to stop both servers gracefully

**Configuration** (`apps/api/src/config/env.ts`):
- `REDIRECT_PORT`: Port for redirect server (default 3001)
- `REDIRECT_SERVER_IP`: IP for DNS A records (default 127.0.0.1, used in Plan 02)

### Test Coverage

18 comprehensive tests covering all redirect server functionality:

1. **Redirect behavior** (5 tests):
   - Domain with targetUrl returns 301
   - Path preservation: `/about` → `target.com/about`
   - Query preservation: `?ref=abc` → `target.com?ref=abc`
   - Combined: `/page?key=val` → `target.com/page?key=val`
   - Registered status domains redirect same as live status

2. **Page responses** (3 tests):
   - Holding page for domains without targetUrl (contains "not configured")
   - Landing page for unknown domains (contains "available for registration")
   - Pending status domains show holding page

3. **Caching** (2 tests):
   - Cache hit: Second request uses cached value (verified via cache.get)
   - Cache invalidation: After cache.del, next request queries DB again

4. **Edge cases** (3 tests):
   - Port in Host header stripped correctly
   - Root request without valid domain returns service info
   - ACME challenge path returns 404 placeholder

5. **Cache unit tests** (5 tests):
   - Store and retrieve values
   - Returns null for missing keys
   - Delete removes values
   - Flush clears all values
   - Accepts custom TTL

Total: 120 tests passing (102 existing + 18 new)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Redirect server starting during test imports**
- **Found during:** Test execution
- **Issue:** When tests imported index.ts, redirect server started and bound to port 3001, causing conflicts between test files
- **Fix:** Wrapped Bun.serve call in `if (env.NODE_ENV !== 'test')` conditional
- **Files modified:** apps/api/src/index.ts
- **Commit:** 9b4bd50

**2. [Rule 1 - Bug] ACME challenge route unreachable with wildcard routing**
- **Found during:** Test execution
- **Issue:** Hono's `/:domain{.+\\..+}/*` wildcard pattern matched before specific ACME route, causing landing page instead of 404
- **Fix:** Moved ACME challenge check inside main domain handler middleware, check subpath for `/.well-known/acme-challenge/` prefix
- **Files modified:** apps/api/src/redirect/server.ts
- **Commit:** 9b4bd50

**3. [Rule 1 - Bug] Root endpoint pattern too specific**
- **Found during:** Test development
- **Issue:** Pattern `app.get('/', ...)` only matched exact `/`, not handling localhost or non-domain hosts
- **Fix:** Changed to `app.get('/*', ...)` catch-all for requests not matching domain pattern
- **Files modified:** apps/api/src/redirect/server.ts
- **Commit:** 9b4bd50

## Integration Points

**With Phase 4 (Registration Flow):**
- Reads domain records from database including status and targetUrl fields
- Respects domain status: 'live' and 'registered' domains can redirect

**For Phase 5 Plan 02 (DNS Configuration):**
- Provides REDIRECT_SERVER_IP env var for DNS A record configuration
- Server runs on dedicated port for DNS pointing

**For Phase 5 Plan 03 (URL Updates):**
- Exports `domainCache` for cache invalidation after URL updates
- Cache TTL of 300s means updates take ~5 minutes to propagate

**For Phase 5 Plan 04 (SSL Provisioning):**
- ACME challenge route placeholder ready for Let's Encrypt integration
- Returns 404 with "not yet implemented" message

## Architecture Decisions

### Why separate redirect server?

The redirect server has fundamentally different characteristics from the API:

- **Security model:** Public-facing with no authentication vs authenticated API with x402 payment
- **Traffic patterns:** High-volume redirect traffic vs lower-volume API calls
- **Scaling needs:** Redirect server scales independently based on domain usage
- **Routing complexity:** Host-based routing vs standard REST paths

Running on separate port enables:
- Different rate limiting and caching strategies
- Independent horizontal scaling in production
- Isolated monitoring and logging
- Security hardening focused on redirect-specific threats

### Why in-memory cache over Redis?

For MVP scale (single server, moderate domain count):

**Pros:**
- Zero external dependencies
- Sub-millisecond lookup latency
- Simple deployment (no Redis to configure)
- Automatic TTL expiration with node-cache

**Cons:**
- Cache doesn't survive restarts (acceptable: rebuilds from DB on first request)
- No cache sharing across multiple redirect server instances (deferred to horizontal scaling phase)

**When to revisit:** When horizontal scaling redirect servers or cache hit rate becomes critical performance factor.

### Why 300s TTL?

**Tradeoff analysis:**

Shorter TTL (60s):
- Faster URL update propagation
- More database queries (higher load)
- Lower cache effectiveness

Current (300s):
- 5-minute delay acceptable for URL updates (not real-time use case)
- High cache effectiveness (most domains don't change URLs frequently)
- Reduced database load

Longer TTL (3600s):
- Minimal database queries
- 1-hour propagation delay too long for user experience

**Decision:** 300s balances update propagation with cache performance for typical domain forwarding use case.

## Next Phase Readiness

**Phase 5 Plan 02 (DNS Configuration):** READY
- Redirect server running and accessible
- REDIRECT_SERVER_IP configured for A record values
- Server confirmed working via tests

**Phase 5 Plan 03 (URL Updates):** READY
- domainCache exported for cache invalidation
- Redirect logic handles targetUrl changes
- Tests verify cache invalidation flow works

**Phase 5 Plan 04 (SSL Provisioning):** READY
- ACME challenge route exists and routable
- Returns 404 placeholder ready for Let's Encrypt handler

## Validation

All must-haves verified:

- [x] Registered domain with targetUrl returns HTTP 301 redirect preserving path and query string
- [x] Registered domain without targetUrl shows holding page
- [x] Unknown domain shows landing page with registration CTA
- [x] Redirect server handles multiple domains from database lookups
- [x] Domain-to-URL mappings are cached in memory with TTL for fast lookups

All artifacts created:

- [x] `apps/api/src/redirect/cache.ts` exports DomainCache with get/set/del/flush
- [x] `apps/api/src/redirect/server.ts` exports createRedirectApp with host-based routing
- [x] `apps/api/src/redirect/__tests__/redirect.test.ts` with 18 tests (exceeds 50-line minimum)

All key links verified:

- [x] `server.ts` uses `cache.(get|set|del)` for lookup before DB query
- [x] `server.ts` queries `domains` table for DB fallback
- [x] `index.ts` calls `createRedirectApp` and starts on `REDIRECT_PORT`

## Performance Metrics

**Execution time:** 270 seconds (4.5 minutes)

**Task breakdown:**
- Task 1 (cache + redirect server): ~2 minutes
- Task 2 (integration + tests): ~2.5 minutes

**Lines of code:**
- Implementation: ~220 lines (cache: 30, server: 190)
- Tests: ~360 lines (18 comprehensive tests + 5 cache unit tests)

**Test results:**
- 120 total tests passing
- 18 new redirect tests
- 0 regressions in existing tests
- Test execution time: ~100ms

## Code Snippets

### Host-based routing with getPath

```typescript
const app = new Hono({
  getPath: (req) => {
    const url = new URL(req.url);
    const host = (req.headers.get('host') || url.hostname).split(':')[0];
    return '/' + host + url.pathname;
  },
});
```

### Redirect with path/query preservation

```typescript
const redirectUrl = new URL(targetUrl);
if (subpath !== '/') {
  redirectUrl.pathname = subpath;
}
const originalUrl = new URL(c.req.url);
redirectUrl.search = originalUrl.search;
return c.redirect(redirectUrl.toString(), 301);
```

### Cache-first lookup pattern

```typescript
let targetUrl = cache.get(domain);
if (!targetUrl) {
  const domainRecord = await db
    .select()
    .from(domains)
    .where(eq(domains.name, domain))
    .get();
  if (domainRecord?.targetUrl) {
    targetUrl = domainRecord.targetUrl;
    cache.set(domain, targetUrl);
  }
}
```

---

**Plan:** 05-01
**Status:** Complete
**Date:** 2026-02-04
**Commits:** 90dff1a, 9b4bd50
