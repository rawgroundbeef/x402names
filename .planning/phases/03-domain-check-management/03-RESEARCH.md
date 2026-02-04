# Phase 3: Domain Check & Management - Research

**Researched:** 2026-02-04
**Domain:** Domain validation, availability checking, REST API design, TLD management
**Confidence:** MEDIUM

## Summary

This phase implements API endpoints for domain availability checking (with USDC pricing), domain status queries, and TLD listing. The research covers domain validation standards (RFC-based), REST API design patterns for 2026, batch operation handling, domain suggestion algorithms, and TLD management strategies.

The standard approach is to use dedicated domain validation libraries (tldts or validator functions) combined with Zod schemas for API request validation, Hono's error handling for structured responses following RFC 9457 Problem Details, and a static TLD configuration refreshed periodically from the registrar's pricing API.

**Primary recommendation:** Use `tldts` for domain parsing/validation, Zod schemas for API input validation, batch requests with up to 10 domains, RFC 9457 Problem Details for error responses, and static TLD config with periodic refresh from Namecheap's `getPricing` API.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tldts | ^6.x | Domain parsing & validation | Fastest domain parser (2-3M/sec), validates hostnames, extracts domain/subdomain/TLD, RFC-compliant |
| zod | ^3.25+ | Request schema validation | Already in codebase, TypeScript-first, inference support, works natively with Hono |
| hono | ^4.6+ | API framework | Already in use, built-in validation middleware, HTTPException handling |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @hono/zod-validator | ^0.2.x | Zod integration for Hono | Standard way to wire Zod schemas to Hono routes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tldts | is-valid-domain | tldts is 10x faster, more features, actively maintained |
| tldts | parse-domain | tldts has better performance, more comprehensive validation |
| Static TLD config | Live PSL fetch | PSL not designed for TLD validation, causes false negatives, requires frequent updates |

**Installation:**
```bash
npm install tldts @hono/zod-validator
```

## Architecture Patterns

### Recommended Project Structure
```
apps/api/src/
├── routes/
│   ├── domains/
│   │   ├── check.ts         # Availability endpoint
│   │   ├── status.ts        # Status lookup endpoint
│   │   └── tlds.ts          # TLD listing endpoint
│   └── health.ts
├── lib/
│   ├── validation/
│   │   └── domain.ts        # Domain validation logic + Zod schemas
│   └── suggestions/
│       └── alternatives.ts  # Domain suggestion algorithm
├── config/
│   ├── env.ts
│   └── tlds.json            # Static TLD pricing config
└── integrations/
    └── registrar/           # Existing registrar abstraction
```

### Pattern 1: Domain Validation with tldts
**What:** Use tldts to parse and validate domain structure, then apply business rules
**When to use:** All domain input validation
**Example:**
```typescript
// Source: tldts npm package documentation
import { parse } from 'tldts';

function validateDomain(input: string): { valid: boolean; domain?: string; sld?: string; tld?: string; error?: string } {
  const parsed = parse(input, { allowPrivateDomains: false });

  // Check if valid domain structure
  if (!parsed.domain || !parsed.domainWithoutSuffix || !parsed.publicSuffix) {
    return { valid: false, error: 'Invalid domain format' };
  }

  // Reject subdomains (only second-level domains allowed)
  if (parsed.subdomain) {
    return { valid: false, error: 'Subdomains not supported' };
  }

  // Check label length (max 63 chars per RFC 1035)
  if (parsed.domainWithoutSuffix.length > 63) {
    return { valid: false, error: 'Domain label exceeds 63 characters' };
  }

  // Check total length (max 253 chars per RFC 1035)
  if (parsed.domain.length > 253) {
    return { valid: false, error: 'Domain exceeds 253 characters' };
  }

  // Check character validity (a-z, 0-9, hyphen, no leading/trailing hyphens)
  const labelPattern = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
  if (!labelPattern.test(parsed.domainWithoutSuffix)) {
    return { valid: false, error: 'Invalid characters or hyphen placement' };
  }

  return {
    valid: true,
    domain: parsed.domain,
    sld: parsed.domainWithoutSuffix,
    tld: parsed.publicSuffix
  };
}
```

### Pattern 2: Batch Request Validation
**What:** Accept array of domains, validate each, return structured results
**When to use:** Availability check endpoint
**Example:**
```typescript
// Source: Hono validation docs + RFC 9457 pattern
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

const domainSchema = z.string().min(1).max(253);

const batchCheckSchema = z.object({
  domains: z.array(domainSchema).min(1).max(10)
});

app.post('/check', zValidator('json', batchCheckSchema), async (c) => {
  const { domains } = c.req.valid('json');

  const results = await Promise.all(
    domains.map(async (domain) => {
      const validation = validateDomain(domain);
      if (!validation.valid) {
        return {
          domain,
          available: false,
          error: validation.error
        };
      }

      const availability = await registrar.checkAvailability(validation.domain!);
      const price = availability.available
        ? await registrar.getPrice(validation.domain!)
        : null;

      return {
        domain: validation.domain,
        available: availability.available,
        price: price ? (price.registrationPrice * 1.20).toFixed(2) : null,
        suggestions: availability.available ? [] : generateSuggestions(validation.domain!)
      };
    })
  );

  return c.json({ results });
});
```

### Pattern 3: RFC 9457 Problem Details Error Response
**What:** Standardized machine-readable error format
**When to use:** All error responses
**Example:**
```typescript
// Source: RFC 9457 Problem Details standard
interface ProblemDetails {
  type: string;        // Machine-readable error code
  title: string;       // Short human-readable summary
  status: number;      // HTTP status code
  detail: string;      // Detailed explanation
  instance?: string;   // Request ID for tracing
}

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const problem: ProblemDetails = {
      type: `error:${err.status}`,
      title: err.message,
      status: err.status,
      detail: err.message,
      instance: c.req.header('x-request-id')
    };
    return c.json(problem, err.status);
  }

  return c.json({
    type: 'error:internal',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred'
  }, 500);
});
```

### Pattern 4: Domain Suggestion Algorithm
**What:** Generate available alternatives when domain is taken
**When to use:** When availability check returns unavailable
**Example:**
```typescript
// Source: Common domain generator patterns research
function generateSuggestions(domain: string, count: 5): string[] {
  const parsed = parse(domain);
  const sld = parsed.domainWithoutSuffix!;
  const tld = parsed.publicSuffix!;

  const suggestions: string[] = [];

  // Strategy 1: Common prefixes
  const prefixes = ['get', 'my', 'the', 'try', 'use'];
  prefixes.forEach(prefix => suggestions.push(`${prefix}${sld}.${tld}`));

  // Strategy 2: Common suffixes
  const suffixes = ['app', 'hq', 'io', 'now', 'online'];
  suffixes.forEach(suffix => suggestions.push(`${sld}${suffix}.${tld}`));

  // Strategy 3: Alternative TLDs
  const altTlds = ['.io', '.co', '.net', '.org', '.app'];
  altTlds.forEach(altTld => suggestions.push(`${sld}${altTld}`));

  // Strategy 4: Hyphenated variations
  if (!sld.includes('-')) {
    suggestions.push(`get-${sld}.${tld}`);
    suggestions.push(`${sld}-app.${tld}`);
  }

  // Return top N, shuffled for variety
  return suggestions
    .filter((s, i, arr) => arr.indexOf(s) === i) // Dedupe
    .slice(0, count * 3) // Get more candidates
    .sort(() => Math.random() - 0.5) // Shuffle
    .slice(0, count);
}
```

### Pattern 5: Static TLD Config with Periodic Refresh
**What:** Store TLD pricing in static JSON, refresh via background job
**When to use:** TLD listing and pricing lookups
**Example:**
```typescript
// Source: Best practices for API caching + Namecheap API docs
// config/tlds.json (generated by refresh job)
{
  "lastUpdated": "2026-02-04T10:00:00Z",
  "tlds": [
    { "tld": ".com", "price": 10.98, "currency": "USD" },
    { "tld": ".net", "price": 13.98, "currency": "USD" },
    { "tld": ".io", "price": 39.98, "currency": "USD" }
  ]
}

// Background refresh job (run daily via cron)
async function refreshTldPricing() {
  const xml = await namecheapRegistrar.callApi('namecheap.users.getPricing', {
    ProductType: 'DOMAIN'
  });

  // Parse XML to extract all TLD pricing
  const tlds = parseNamecheapPricing(xml);

  // Write to static config
  await fs.writeFile('config/tlds.json', JSON.stringify({
    lastUpdated: new Date().toISOString(),
    tlds
  }, null, 2));
}

// Route handler reads from static file
app.get('/tlds', async (c) => {
  const config = JSON.parse(await fs.readFile('config/tlds.json', 'utf-8'));
  return c.json({
    tlds: config.tlds.map(t => ({
      tld: t.tld,
      price: (t.price * 1.20).toFixed(2), // Apply 20% markup
      currency: 'USDC'
    })),
    lastUpdated: config.lastUpdated
  });
});
```

### Anti-Patterns to Avoid
- **Using regex-only validation:** Domain validation is complex; regex alone misses edge cases (IDNA, length limits, TLD validity). Use dedicated parsers like tldts.
- **Live PSL fetching:** Public Suffix List is not designed for TLD validation and changes frequently. Use static config refreshed periodically.
- **Synchronous domain checks in loop:** Always use Promise.all for batch availability checks to avoid sequential bottlenecks.
- **Generic error messages:** Return machine-readable error codes (RFC 9457) so AI agents can handle errors programmatically.
- **Unbounded batch sizes:** Limit to 10 domains per request to prevent abuse and timeout issues.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Domain parsing | Custom string splitting on "." | tldts library | Handles edge cases: multi-part TLDs (.co.uk), public suffixes, IDNA, validation edge cases that regex misses |
| TLD validation | Regex for .com/.net/etc | tldts + static config from registrar | Over 1,400 TLDs exist, constantly changing; hand-rolling will miss new TLDs and incorrectly validate decommissioned ones |
| Request validation | Manual parameter checking | Zod schemas with Hono validator | Type-safe, automatic error responses, handles nested objects, arrays, refinements |
| Error responses | Custom JSON objects | RFC 9457 Problem Details | Standardized format, machine-readable, AI agent-friendly, industry best practice |
| Domain suggestions | Random string generation | Prefix/suffix/TLD-swap algorithm | Users expect meaningful suggestions (prefixes like "get", "my"; suffixes like "app", "hq"; alternative TLDs) |
| Batch rate limiting | Custom counters | Token bucket algorithm (future phase) | Handles bursts, prevents abuse, standard pattern; defer to Phase 6 hardening |

**Key insight:** Domain validation has decades of edge cases (RFC 952, RFC 1123, RFC 1035, RFC 5890 IDNA). Libraries like tldts encode this knowledge. Custom validation will miss cases like: leading digits (allowed per RFC 1123 but not RFC 952), multi-part TLDs (.co.uk vs .uk), IDN handling, label length limits, total length limits, hyphen placement rules, and the constantly-evolving TLD landscape.

## Common Pitfalls

### Pitfall 1: Subdomain Confusion
**What goes wrong:** Accepting "blog.example.com" when only second-level domains should be allowed
**Why it happens:** Regex or simple string parsing doesn't distinguish subdomain from domain
**How to avoid:** Use tldts to parse, check if `parsed.subdomain` is present, reject if non-null
**Warning signs:** Users report "valid" domains being rejected; testing with subdomain.domain.tld passes validation

### Pitfall 2: TLD Validation Staleness
**What goes wrong:** Rejecting valid TLDs (e.g., ".io" added after code written) or accepting invalid ones (e.g., decommissioned TLDs)
**Why it happens:** Using hardcoded TLD list or outdated Public Suffix List
**How to avoid:** Fetch TLD list from Namecheap `getPricing` API daily, store statically, use in validation
**Warning signs:** Users report ".io" or other newer TLDs rejected; old/unused TLDs pass validation

### Pitfall 3: Length Validation Inconsistency
**What goes wrong:** Accepting domains that exceed RFC 1035 limits (63 chars per label, 253 total)
**Why it happens:** Not checking label and total length separately
**How to avoid:** Validate both: each label <= 63 chars, full domain <= 253 chars (tldts doesn't enforce this)
**Warning signs:** Very long domains get through validation; registrar rejects them later

### Pitfall 4: Hyphen Placement Errors
**What goes wrong:** Accepting "-example.com" or "example-.com"
**Why it happens:** Regex allows hyphens anywhere, but RFC 952/1123 forbids leading/trailing hyphens
**How to avoid:** Use pattern `/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i` which enforces no leading/trailing hyphens
**Warning signs:** Domains like "-test.com" pass validation; registrar returns "invalid domain" error

### Pitfall 5: Batch Request Timeout
**What goes wrong:** Batch availability checks timeout when checking many domains
**Why it happens:** Sequential registrar API calls (await in loop) cause cumulative delay
**How to avoid:** Use Promise.all to parallelize registrar calls; set reasonable batch limit (10 domains)
**Warning signs:** Response times scale linearly with domain count; timeout errors on >5 domains

### Pitfall 6: Unclear Error Codes
**What goes wrong:** AI agents can't programmatically handle errors, retry inappropriately
**Why it happens:** Returning generic HTTP 400 with human-readable message instead of machine-readable codes
**How to avoid:** Implement RFC 9457 Problem Details with `type` field containing machine-readable code
**Warning signs:** Support requests about agents repeatedly retrying invalid requests; no structured error handling in agent logs

### Pitfall 7: Price Calculation Drift
**What goes wrong:** USDC price doesn't match "registrar cost + 20%" promise
**Why it happens:** Applying markup incorrectly (e.g., rounding too early, wrong precision)
**How to avoid:** Calculate as `(registrarPrice * 1.20).toFixed(2)`, apply markup before rounding
**Warning signs:** Prices end in odd amounts; users report math doesn't add up

### Pitfall 8: Missing Alternative Suggestions
**What goes wrong:** Returning empty suggestions array when domain unavailable
**Why it happens:** Suggestion algorithm fails silently, or not called at all
**How to avoid:** Always return 3-5 suggestions for unavailable domains; test suggestion algorithm separately
**Warning signs:** User complaints about unhelpful responses; empty `suggestions` array in production logs

## Code Examples

Verified patterns from official sources:

### Zod Schema for Domain Validation
```typescript
// Source: Zod documentation + domain validation patterns
import { z } from 'zod';
import { parse } from 'tldts';

const domainValidator = z.string()
  .min(1, 'Domain cannot be empty')
  .max(253, 'Domain exceeds maximum length of 253 characters')
  .transform((val) => val.toLowerCase().trim())
  .refine((val) => {
    const parsed = parse(val, { allowPrivateDomains: false });
    return parsed.domain !== null && !parsed.subdomain;
  }, 'Invalid domain format or subdomain not allowed')
  .refine((val) => {
    const parsed = parse(val);
    const label = parsed.domainWithoutSuffix || '';
    return label.length <= 63;
  }, 'Domain label exceeds 63 characters')
  .refine((val) => {
    const parsed = parse(val);
    const label = parsed.domainWithoutSuffix || '';
    return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(label);
  }, 'Invalid characters or hyphen placement');

const checkAvailabilitySchema = z.object({
  domains: z.array(domainValidator).min(1).max(10)
});
```

### Hono Route with Validation and Error Handling
```typescript
// Source: Hono validation examples + error handling docs
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';

const app = new Hono();

app.post(
  '/domains/check',
  zValidator('json', checkAvailabilitySchema),
  async (c) => {
    const { domains } = c.req.valid('json');

    try {
      const results = await checkDomainAvailability(domains);
      return c.json({ results });
    } catch (error) {
      if (error instanceof RegistrarUnavailable) {
        throw new HTTPException(503, {
          message: 'Domain registrar temporarily unavailable'
        });
      }
      throw error;
    }
  }
);

// Error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({
      type: `error:${err.status}`,
      title: err.message,
      status: err.status,
      detail: err.message
    }, err.status);
  }

  return c.json({
    type: 'error:internal',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred'
  }, 500);
});
```

### Domain Status Lookup
```typescript
// Source: Existing registrar abstraction + business requirements
async function getDomainStatus(domain: string) {
  // Check if domain is in our database first
  const dbDomain = await db.query.domains.findFirst({
    where: eq(domains.name, domain)
  });

  if (dbDomain) {
    return {
      domain: `${dbDomain.name}.${dbDomain.tld}`,
      status: mapDbStatusToApiStatus(dbDomain.status),
      ownerWallet: dbDomain.ownerWallet,
      targetUrl: dbDomain.targetUrl,
      registeredAt: dbDomain.createdAt,
      expiresAt: calculateExpiry(dbDomain.createdAt), // Typically +1 year
      lastUpdated: dbDomain.updatedAt
    };
  }

  // Not in our system, check if available
  const availability = await registrar.checkAvailability(domain);

  return {
    domain,
    status: availability.available ? 'available' : 'registered',
    ownerWallet: null,
    targetUrl: null,
    registeredAt: null,
    expiresAt: null,
    lastUpdated: new Date().toISOString()
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Regex-only domain validation | tldts + validation library | 2020-2023 | Handles IDNA, multi-part TLDs, public suffixes correctly |
| Public Suffix List for TLD validation | Registrar-sourced TLD list | 2024+ | Avoids PSL update lag, only validates TLDs we can sell |
| Custom error JSON | RFC 9457 Problem Details | 2016 (RFC published), adopted widely 2023+ | Machine-readable errors for AI agents, standardized format |
| Sequential batch processing | Promise.all parallel processing | Always best practice | 10x faster for batch operations |
| Manual schema validation | Zod + type inference | 2020+ | Type-safe validation, reduces bugs, better DX |

**Deprecated/outdated:**
- **RFC 3490 (IDNA2003)**: Replaced by RFC 5890-5894 (IDNA2008) for internationalized domain names
- **Public Suffix List for domain validation**: Intended for browser cookie security, not domain validation; causes false negatives with outdated versions
- **Unbounded batch requests**: Modern APIs limit batch size (10-100 items) to prevent abuse and timeouts

## Open Questions

Things that couldn't be fully resolved:

1. **Namecheap API TLD enumeration**
   - What we know: `namecheap.users.getPricing` returns all TLD pricing; Namecheap supports 1000+ TLDs
   - What's unclear: Exact XML structure, whether single API call returns all TLDs or requires pagination
   - Recommendation: During implementation, call API in development environment and inspect XML structure; implement parsing based on actual response format

2. **Domain suggestion quality threshold**
   - What we know: Common strategies include prefix/suffix/TLD-swap; users expect 3-5 suggestions
   - What's unclear: How to ensure suggestions are actually available without checking each one (performance vs quality tradeoff)
   - Recommendation: Generate 15-20 candidates, batch check availability for top 10, return first 5 available; measure and optimize based on hit rate

3. **TLD refresh frequency**
   - What we know: TLDs change weekly (new releases, decommissions); daily refresh is safe minimum
   - What's unclear: Whether to refresh on startup, via cron, or on-demand; how to handle refresh failures
   - Recommendation: Daily cron job with fallback to last-known-good config; add health check endpoint showing TLD config age

4. **IDNA (Internationalized Domain Names) support**
   - What we know: IDNA2008 (RFC 5890) is current standard; tldts supports IDNA; Namecheap supports IDN
   - What's unclear: Whether to support IDN in Phase 3 or defer to later phase; adds complexity to validation
   - Recommendation: Defer IDN support to Phase 6 (hardening); focus on ASCII-only domains (a-z, 0-9, hyphen) for MVP; add requirement to Phase 6 if user demand exists

5. **Premium domain pricing**
   - What we know: Namecheap API returns `isPremium` flag; premium domains have variable pricing
   - What's unclear: How to handle premium domain pricing (different API call? manual lookup?)
   - Recommendation: Return `price: null` for premium domains with message "Contact for pricing"; defer premium support to Phase 6 or post-MVP

## Sources

### Primary (HIGH confidence)
- RFC 1035 - Domain name specification: https://datatracker.ietf.org/doc/html/rfc1035
- RFC 1123 - Host naming requirements: https://datatracker.ietf.org/doc/html/rfc1123
- RFC 5890 - IDNA2008 definitions: https://datatracker.ietf.org/doc/html/rfc5890
- RFC 9457 - Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457 (inferred from 2026 sources mentioning this standard)
- tldts npm package: https://www.npmjs.com/package/tldts
- Hono validation documentation: https://hono.dev/docs/guides/validation
- Hono error handling documentation: https://hono.dev/examples/validator-error-handling
- Zod documentation: https://zod.dev/

### Secondary (MEDIUM confidence)
- Modern API Design Best Practices for 2026: https://www.xano.com/blog/modern-api-design-best-practices/
- Best Practices for REST API Error Handling | Baeldung: https://www.baeldung.com/rest-api-error-handling-best-practices
- REST API Error Handling: Best Practices and Status Codes: https://blog.apilayer.com/best-practices-for-rest-api-error-handling-in-2025/
- 7 API rate limit best practices: https://www.merge.dev/blog/api-rate-limit-best-practices
- Domain Name Syntax Rules | NameSilo: https://www.namesilo.com/blog/en/domain-names/domain-name-syntax-rules-understanding-rfc-standards-and-limitations
- Namecheap API documentation (getPricing): https://www.namecheap.com/support/api/methods/users/get-pricing/
- Public Suffix List: https://publicsuffix.org/

### Tertiary (LOW confidence)
- Domain name suggestion algorithm strategies: https://leandomainsearch.com/top-domain-name-prefixes-and-suffixes/
- Common pitfalls in domain validation: https://infinitejs.com/posts/common-regex-pitfalls-domain-validation/
- TLD landscape 2026: https://tldz.com/tld-list/
- Domain generator best practices: https://www.hostinger.com/in/tutorials/domain-name-generators

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - tldts, Zod, and Hono are verified from official docs and package registries
- Architecture: MEDIUM - Patterns are industry-standard but specific implementation for x402names context needs validation
- Pitfalls: MEDIUM - Based on web search findings and general domain validation knowledge, not x402names-specific testing
- RFC specifications: HIGH - Official RFC documents are authoritative
- Namecheap API details: LOW - Official API docs blocked by 403, relying on community descriptions

**Research date:** 2026-02-04
**Valid until:** 2026-03-04 (30 days for stable domain, libraries could have updates but patterns remain valid)
