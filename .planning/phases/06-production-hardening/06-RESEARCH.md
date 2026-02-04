# Phase 6: Production Hardening - Research

**Researched:** 2026-02-04
**Domain:** API hardening, rate limiting, input validation, error handling
**Confidence:** HIGH

## Summary

Production hardening for a Hono/Bun API focuses on four key areas: rate limiting free endpoints while allowing payment-throttled paid endpoints, validating domain names and URLs against security threats, standardizing error responses using the existing RFC 9457 framework, and documenting error scenarios in machine-readable format.

The codebase already has strong foundations: RFC 9457 error framework implemented (`apps/api/src/lib/errors.ts`), domain validation with tldts library (`apps/api/src/lib/validation/domain.ts`), and Zod-based input validation. This phase extends these foundations rather than building from scratch.

**Primary recommendation:** Use `hono-rate-limiter` with in-memory store for single-server deployment, extend existing RFC 9457 error handlers with validation error aggregation, add URL validation with SSRF prevention using manual checks rather than external libraries, and generate error catalog as structured JSON for agent consumption.

## Standard Stack

The established libraries/tools for production hardening in Hono/Bun:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hono-rate-limiter | 0.5.x | Rate limiting middleware | Official Hono ecosystem middleware, actively maintained |
| tldts | 7.0.x | Domain parsing/validation | Fast (2-3M ops/sec), RFC-compliant, already in use |
| Zod | 4.3.x | Schema validation | Already integrated with Hono, TypeScript-first |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node-cache | 5.1.x | In-memory caching | Already in use for domain cache, could store rate limit state |
| @hono/zod-validator | 0.7.x | Zod integration for Hono | Already in use, extend for multi-error validation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| hono-rate-limiter | Custom implementation | Custom gives control but requires handling edge cases (clock skew, memory leaks, distributed state) |
| Manual URL validation | dssrf library | dssrf is comprehensive but adds dependency; manual validation sufficient for http/https-only use case |
| In-memory rate limiting | Redis store | Redis needed for multi-server; single-server deployment doesn't need complexity |

**Installation:**
```bash
npm install hono-rate-limiter@0.5
# All other dependencies already present
```

## Architecture Patterns

### Recommended Project Structure
```
apps/api/src/
├── lib/
│   ├── errors.ts              # RFC 9457 handlers (existing, extend)
│   ├── validation/
│   │   ├── domain.ts          # Domain validation (existing)
│   │   └── url.ts             # URL validation (new)
│   └── middleware/
│       └── rate-limit.ts      # Rate limiting config (new)
├── routes/
│   └── [endpoints]            # Apply rate limiting per route
└── docs/
    └── error-catalog.json     # Machine-readable error reference (new)
```

### Pattern 1: Per-Route Rate Limiting
**What:** Apply different rate limits to different endpoint types (free read vs paid write)
**When to use:** When different endpoints have different abuse profiles

**Example:**
```typescript
// Source: hono-rate-limiter documentation
import { rateLimiter } from 'hono-rate-limiter';

// Read endpoints: generous limits
const readLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 100, // 100 requests per minute per IP
  standardHeaders: 'draft-6',
  keyGenerator: (c) => c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown',
  handler: (c) => {
    return c.json({
      type: 'error:rate_limit_exceeded',
      title: 'Rate Limit Exceeded',
      status: 429,
      detail: 'Too many requests, please try again later'
    }, 429, {
      'Retry-After': '60'
    });
  }
});

// Paid endpoints: no rate limiting (payment throttles)
app.get('/domains/check', readLimiter, checkHandler);
app.post('/domains/register', registerHandler); // No rate limit
```

### Pattern 2: Aggregated Validation Errors
**What:** Collect all validation errors before returning, not fail-fast
**When to use:** For better developer experience with API clients

**Example:**
```typescript
// Source: RFC 9457 + validation best practices
export function createValidationProblem(
  c: Context,
  errors: Array<{ field: string; message: string }>
) {
  return c.json({
    type: 'error:validation',
    title: 'Validation Failed',
    status: 400,
    detail: 'Request contains validation errors',
    errors: errors.map(e => ({
      field: e.field,
      message: e.message
    }))
  }, 400);
}

// Usage in validator
export function validateUrlUpdate(domain: string, url: string): ValidationResult {
  const errors = [];

  const domainResult = validateDomain(domain);
  if (!domainResult.valid) {
    errors.push({ field: 'domain', message: domainResult.error });
  }

  const urlResult = validateUrl(url);
  if (!urlResult.valid) {
    errors.push({ field: 'url', message: urlResult.error });
  }

  return { valid: errors.length === 0, errors };
}
```

### Pattern 3: SSRF-Safe URL Validation
**What:** Validate URLs to prevent Server-Side Request Forgery attacks
**When to use:** Any endpoint accepting user-provided URLs

**Example:**
```typescript
// Source: OWASP SSRF Prevention Cheat Sheet
export function validateUrl(input: string): { valid: boolean; error?: string } {
  // 1. Parse URL
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // 2. Restrict protocol
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, error: 'Only HTTP/HTTPS protocols allowed' };
  }

  // 3. Block localhost and private IPs
  const hostname = parsed.hostname.toLowerCase();

  // Localhost patterns
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    return { valid: false, error: 'Localhost URLs not allowed' };
  }

  // Private IPv4 ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 169 && b === 254 // Link-local
    ) {
      return { valid: false, error: 'Private IP addresses not allowed' };
    }
  }

  // 4. Block embedded credentials
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs with credentials not allowed' };
  }

  // 5. Length check (prevent DoS)
  if (input.length > 2048) {
    return { valid: false, error: 'URL too long (max 2048 characters)' };
  }

  return { valid: true };
}
```

### Anti-Patterns to Avoid

- **Fail-fast validation:** Returning only the first error frustrates API consumers who must fix errors iteratively
- **Rate limiting paid endpoints:** Payment is already the throttle; additional rate limits add complexity without benefit
- **Ignoring Retry-After header:** Clients need to know when to retry; always include with 429 responses
- **Using regex-only URL validation:** Regex can miss edge cases and is vulnerable to ReDoS attacks
- **Blacklist-based validation:** Blacklists are bypassable; use whitelists (allow only http/https, reject private IPs)

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting | Custom request counting | hono-rate-limiter | Handles memory cleanup, distributed keys, sliding/fixed windows, standards-compliant headers |
| Domain parsing | Regex-based TLD extraction | tldts (already in use) | Maintains public suffix list, handles internationalization, 2-3M ops/sec |
| Error response format | Custom error JSON | RFC 9457 ProblemDetails (already in use) | Standard format, machine-readable, extensible, client libraries exist |
| Private IP detection | Partial IP range checks | Comprehensive CIDR checks | Easy to miss ranges (link-local 169.254.x.x, multicast 224.0.0.0/4, metadata endpoints) |

**Key insight:** Input validation has decades of edge cases. Domain validation requires maintaining TLD lists (500+ TLDs, changing frequently). URL validation must block localhost, 127.0.0.1, ::1, private IPv4 (10.x, 172.16-31.x, 192.168.x), link-local (169.254.x.x), metadata endpoints (169.254.169.254), and handle IPv6, punycode, percent-encoding. Rate limiting must handle clock skew, memory leaks, distributed state. Use proven libraries.

## Common Pitfalls

### Pitfall 1: Memory Leaks in Rate Limiting
**What goes wrong:** In-memory rate limiters track every unique IP. Without cleanup, this grows unbounded—after a week of production traffic, millions of entries consume gigabytes of RAM.
**Why it happens:** Simple implementations like `Map<IP, count>` never expire old entries.
**How to avoid:** Use hono-rate-limiter's built-in memory store with automatic expiration, or implement TTL-based cleanup if building custom. Monitor memory usage.
**Warning signs:** Gradual memory growth over days/weeks, not correlated with traffic spikes.

### Pitfall 2: Rate Limit State Loss on Deploy
**What goes wrong:** In-memory stores reset on every deployment, allowing attackers to bypass limits by waiting for deployments.
**Why it happens:** State lives in process memory, not persistent storage.
**How to avoid:** For single-server deployment, accept this tradeoff (limits reset briefly during deploys, which happen infrequently). For multi-server or high-security needs, use Redis store. Document the behavior.
**Warning signs:** Rate limits ineffective during deployment windows, attackers timing requests to deploys.

### Pitfall 3: Trusting Client IP Headers
**What goes wrong:** Using `X-Forwarded-For` or `X-Real-IP` without validation allows IP spoofing to bypass rate limits.
**Why it happens:** These headers can be set by clients if not behind a trusted proxy.
**How to avoid:** For Bun's server, use the first IP in `X-Forwarded-For` only if behind a reverse proxy (Cloudflare, nginx). Otherwise use connection IP. For single-server direct-to-internet, connection IP is safest but may miss proxied users.
**Warning signs:** Rate limits ineffective, logs showing impossible IP addresses, attackers bypassing limits easily.

### Pitfall 4: URL Validation Bypass via DNS Rebinding
**What goes wrong:** URL passes validation (points to public IP), then DNS resolves to private IP before actual request.
**Why it happens:** Validating URL string vs. actual connection uses different DNS resolution times.
**How to avoid:** For this use case (storing redirect URLs, not fetching them server-side), DNS rebinding isn't a risk—the redirect happens client-side in browsers. Only validate the URL string format and reject obvious private IPs. Don't build server-side URL fetching.
**Warning signs:** N/A for this use case (client-side redirects), but matters for server-side URL fetching.

### Pitfall 5: Fixed Window Rate Limit Bursting
**What goes wrong:** Fixed 1-minute windows allow 200 requests in 2 seconds (100 at 0:59, 100 at 1:01), defeating rate limits.
**Why it happens:** Fixed windows reset at exact intervals regardless of request timing.
**How to avoid:** Use sliding window algorithm for smoother distribution. hono-rate-limiter supports sliding window. Tradeoff: slightly more complex, more memory per client.
**Warning signs:** Traffic bursts at window boundaries, rate limits ineffective during bursts.

### Pitfall 6: Validation Error Messages Leaking Internals
**What goes wrong:** Error messages like "database constraint violation on domains.url_unique" leak internal schema details.
**Why it happens:** Passing raw database/library errors to API responses.
**How to avoid:** Always sanitize error messages. Internal errors (database, registrar API) return generic "SERVER_ERROR" type with message "An unexpected error occurred". Log detailed errors server-side. Only expose validation errors that help fix client requests.
**Warning signs:** Security scanners flagging information disclosure, detailed internal errors in API responses.

## Code Examples

Verified patterns from official sources:

### Rate Limiting Configuration
```typescript
// Source: hono-rate-limiter documentation
import { rateLimiter } from 'hono-rate-limiter';

// Configure for single-server deployment with in-memory store
export const createReadLimiter = () => rateLimiter({
  windowMs: 60 * 1000, // 1 minute window
  limit: 100, // 100 requests per window per IP

  // Use draft-6 standard headers (RateLimit-* headers)
  standardHeaders: 'draft-6',

  // Extract IP from headers (adjust based on deployment)
  keyGenerator: (c) => {
    // If behind proxy (Cloudflare, nginx), use forwarded IP
    return c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      ?? c.req.header('x-real-ip')
      ?? 'unknown';
  },

  // Custom 429 handler with RFC 9457 format
  handler: (c) => {
    return c.json({
      type: 'error:rate_limit_exceeded',
      title: 'Rate Limit Exceeded',
      status: 429,
      detail: 'Too many requests from your IP address. Please try again later.'
    }, 429, {
      'Retry-After': '60' // Seconds until window resets
    });
  }
});
```

### Multi-Error Validation Hook
```typescript
// Source: RFC 9457 + Hono validation patterns
import type { Hook } from '@hono/zod-validator';
import type { Context } from 'hono';

export const multiErrorValidationHook: Hook<any, any, any, any> = (result, c) => {
  if (!result.success) {
    const errors = 'errors' in result.error ? result.error.errors : [];

    // Collect all validation errors
    const validationErrors = errors.map((err: any) => ({
      field: err.path.join('.'),
      message: err.message
    }));

    return c.json({
      type: 'error:validation',
      title: 'Validation Failed',
      status: 400,
      detail: 'Request contains validation errors',
      errors: validationErrors
    }, 400);
  }
};
```

### Complete URL Validation
```typescript
// Source: OWASP SSRF Prevention Cheat Sheet
const PRIVATE_IPV4_RANGES = [
  { start: [10, 0, 0, 0], end: [10, 255, 255, 255] },         // 10.0.0.0/8
  { start: [172, 16, 0, 0], end: [172, 31, 255, 255] },       // 172.16.0.0/12
  { start: [192, 168, 0, 0], end: [192, 168, 255, 255] },     // 192.168.0.0/16
  { start: [127, 0, 0, 0], end: [127, 255, 255, 255] },       // 127.0.0.0/8 loopback
  { start: [169, 254, 0, 0], end: [169, 254, 255, 255] },     // 169.254.0.0/16 link-local
];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  return PRIVATE_IPV4_RANGES.some(range => {
    for (let i = 0; i < 4; i++) {
      if (parts[i] < range.start[i] || parts[i] > range.end[i]) {
        return false;
      }
    }
    return true;
  });
}

export function validateTargetUrl(input: string): { valid: boolean; error?: string } {
  // Length check first (prevent DoS)
  if (input.length > 2048) {
    return { valid: false, error: 'URL exceeds maximum length (2048 characters)' };
  }

  // Parse URL
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Protocol restriction
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { valid: false, error: 'Only HTTP and HTTPS protocols are allowed' };
  }

  // Hostname checks
  const hostname = url.hostname.toLowerCase();

  // Block localhost
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) {
    return { valid: false, error: 'Localhost URLs are not allowed' };
  }

  // Block private IPs
  if (isPrivateIPv4(hostname)) {
    return { valid: false, error: 'Private IP addresses are not allowed' };
  }

  // Block embedded credentials
  if (url.username || url.password) {
    return { valid: false, error: 'URLs with embedded credentials are not allowed' };
  }

  // Block metadata endpoints (AWS, GCP, Azure)
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    return { valid: false, error: 'Metadata service URLs are not allowed' };
  }

  return { valid: true };
}

// Zod schema integration
export const targetUrlValidator = z
  .string()
  .url('Must be a valid URL')
  .refine(
    (val) => {
      const result = validateTargetUrl(val);
      return result.valid;
    },
    (val) => {
      const result = validateTargetUrl(val);
      return { message: result.error ?? 'Invalid URL' };
    }
  );
```

### Error Catalog Format (Machine-Readable)
```typescript
// Source: RFC 9457 + API documentation best practices
// File: apps/api/src/docs/error-catalog.json
{
  "version": "1.0.0",
  "errors": [
    {
      "code": "RATE_LIMIT_EXCEEDED",
      "type": "error:rate_limit_exceeded",
      "status": 429,
      "title": "Rate Limit Exceeded",
      "description": "Client has exceeded the rate limit for this endpoint",
      "category": "rate_limiting",
      "retryable": true,
      "example": {
        "type": "error:rate_limit_exceeded",
        "title": "Rate Limit Exceeded",
        "status": 429,
        "detail": "Too many requests from your IP address. Please try again later."
      },
      "responseHeaders": {
        "Retry-After": "Seconds to wait before retrying"
      }
    },
    {
      "code": "DOMAIN_INVALID_FORMAT",
      "type": "error:validation",
      "status": 400,
      "title": "Validation Failed",
      "description": "Domain name does not meet format requirements",
      "category": "validation",
      "retryable": false,
      "example": {
        "type": "error:validation",
        "title": "Validation Failed",
        "status": 400,
        "detail": "Request contains validation errors",
        "errors": [
          {
            "field": "domain",
            "message": "Label too long (max 63 characters per label)"
          }
        ]
      }
    },
    {
      "code": "URL_SCHEME_UNSUPPORTED",
      "type": "error:validation",
      "status": 400,
      "title": "Validation Failed",
      "description": "Target URL uses unsupported protocol scheme",
      "category": "validation",
      "retryable": false,
      "example": {
        "type": "error:validation",
        "title": "Validation Failed",
        "status": 400,
        "detail": "Request contains validation errors",
        "errors": [
          {
            "field": "url",
            "message": "Only HTTP and HTTPS protocols are allowed"
          }
        ]
      }
    },
    {
      "code": "URL_PRIVATE_ADDRESS",
      "type": "error:validation",
      "status": 400,
      "title": "Validation Failed",
      "description": "Target URL points to private or localhost address",
      "category": "validation",
      "retryable": false,
      "example": {
        "type": "error:validation",
        "title": "Validation Failed",
        "status": 400,
        "detail": "Request contains validation errors",
        "errors": [
          {
            "field": "url",
            "message": "Private IP addresses are not allowed"
          }
        ]
      }
    },
    {
      "code": "SERVER_ERROR",
      "type": "error:internal",
      "status": 500,
      "title": "Internal Server Error",
      "description": "An unexpected error occurred on the server",
      "category": "server",
      "retryable": true,
      "example": {
        "type": "error:internal",
        "title": "Internal Server Error",
        "status": 500,
        "detail": "An unexpected error occurred"
      }
    }
  ]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| RFC 7807 Problem Details | RFC 9457 Problem Details | July 2023 | Minor refinements to type field usage, backward compatible |
| Express rate-limit | hono-rate-limiter | 2024 | Hono-native middleware, TypeScript-first, better tree-shaking |
| Blacklist-based URL validation | Whitelist + SSRF prevention | Ongoing | Shift to default-deny for protocols, explicit IP range blocking |
| fail-fast validation | Aggregate all errors | 2020s trend | Better DX, fewer round-trips for API consumers |
| Custom error formats | RFC 9457 standardization | 2023+ | Machine-readable, client libraries, consistent across APIs |

**Deprecated/outdated:**
- **RFC 7807:** Superseded by RFC 9457 in 2023, though still widely compatible
- **X-RateLimit-* headers (legacy):** Replaced by standardized RateLimit-* headers (draft-6), though still common
- **Regex-only domain validation:** Insufficient for internationalized domains, TLD changes; use parsing libraries like tldts

## Open Questions

Things that couldn't be fully resolved:

1. **IP extraction strategy for rate limiting**
   - What we know: Single-server Bun deployment, may be behind reverse proxy
   - What's unclear: Whether production deployment uses Cloudflare/nginx proxy
   - Recommendation: Make IP extraction configurable via environment variable. Default to X-Forwarded-For if BEHIND_PROXY=true, else use connection IP. Document this in implementation.

2. **Rate limit window size for "generous" limits**
   - What we know: User wants 100+ requests/min for read endpoints
   - What's unclear: Exact balance between preventing abuse and allowing legitimate high-frequency use
   - Recommendation: Start with 100 requests per 60-second sliding window per IP. Monitor in production and adjust. Document that paid endpoints have no rate limits.

3. **Error catalog format preference**
   - What we know: Machine-readable format for agents, will become agent skill later
   - What's unclear: Whether to use OpenAPI spec, standalone JSON, or inline documentation
   - Recommendation: Use standalone JSON file (apps/api/src/docs/error-catalog.json) for now. Easy to generate, parse, and convert to OpenAPI later. Serve via GET /api/errors endpoint for agent discovery.

## Sources

### Primary (HIGH confidence)
- RFC 9457 Problem Details for HTTP APIs - https://www.rfc-editor.org/rfc/rfc9457.html
- OWASP SSRF Prevention Cheat Sheet - https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- hono-rate-limiter GitHub - https://github.com/rhinobase/hono-rate-limiter
- RFC 1035 DNS Specification - https://www.rfc-editor.org/rfc/rfc1035
- Existing codebase analysis - apps/api/src/lib/errors.ts, apps/api/src/lib/validation/domain.ts

### Secondary (MEDIUM confidence)
- [Hono Rate Limiting Introduction - DEV Community](https://dev.to/fiberplane/an-introduction-to-rate-limiting-3j0)
- [Building a Custom Rate Limiter for Hono](https://schof.co/building-a-custom-rate-limiter-for-hono/)
- [Understanding RFC 9457 - Medium](https://medium.com/@mhd.umair/understanding-rfc-9457-problem-details-for-http-apis-6bdb675e685f)
- [Problem Details RFC 9457 API Error Handling - Swagger](https://swagger.io/blog/problem-details-rfc9457-api-error-handling/)
- [API Rate Limiting Best Practices - Postman](https://blog.postman.com/what-is-api-rate-limiting/)
- [Retry-After Header Best Practices - TheLinuxCode](https://thelinuxcode.com/http-headers-retry-after-practical-patterns-pitfalls-and-production-ready-use/)
- [Rate Limiting Best Practices - Speakeasy](https://www.speakeasy.com/api-design/rate-limiting)
- [Error Handling Best Practices - Postman](https://blog.postman.com/best-practices-for-api-error-handling/)
- [DNS Hostname Validation - O'Reilly](https://www.oreilly.com/library/view/regular-expressions-cookbook/9781449327453/ch08s15.html)
- [URL Length Limits Security - Chromium](https://chromium.googlesource.com/chromium/src/+/master/docs/security/url_display_guidelines/url_display_guidelines.md)

### Tertiary (LOW confidence)
- [Bun API Rate Limiting - CodingTag](https://www.codingtag.com/bun-api-rate-limiting) - Basic patterns, not Hono-specific
- [tldts npm](https://www.npmjs.com/package/tldts) - Library documentation
- [dssrf library - Snyk](https://snyk.io/blog/preventing-server-side-request-forgery-node-js/) - Alternative approach, not needed for this use case

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - hono-rate-limiter is official Hono ecosystem package, tldts already in use, RFC 9457 already implemented
- Architecture patterns: HIGH - RFC 9457 spec is authoritative, OWASP SSRF patterns are standard, hono-rate-limiter docs verified
- Pitfalls: MEDIUM - Based on real-world experience articles and production incident reports, not all specific to Hono/Bun
- URL validation specifics: HIGH - OWASP guidelines are security standard, IP ranges from RFC specifications
- Error catalog format: MEDIUM - General API documentation best practices, not Hono-specific standard

**Research date:** 2026-02-04
**Valid until:** 30 days (2026-03-06) - Rate limiting and validation patterns are stable; hono-rate-limiter is active but mature
