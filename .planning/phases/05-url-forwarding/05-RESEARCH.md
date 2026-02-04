# Phase 5: URL Forwarding - Research

**Researched:** 2026-02-04
**Domain:** HTTP redirect server with multi-domain routing and automatic SSL provisioning
**Confidence:** MEDIUM

## Summary

URL forwarding requires a multi-domain HTTP server that routes requests based on hostname, performs 301 redirects to target URLs, and handles SSL/TLS certificates per domain. The phase involves three primary technical domains:

1. **Multi-domain routing** - Hono's `getPath()` function enables host-based routing on a single server instance
2. **SSL provisioning** - Let's Encrypt with HTTP-01 challenge provides automatic certificates, but Bun lacks native SNI support requiring workarounds
3. **DNS configuration** - Namecheap API's `setHosts` method has destructive overwrite behavior requiring careful implementation

The standard approach is to use Hono for routing with node-cache for domain-to-URL mappings, node-acme-client for SSL automation, and careful DNS record management to avoid data loss.

**Primary recommendation:** Implement host-based routing in existing Hono app using `getPath()`, deploy node-acme-client with HTTP-01 challenges for SSL, and use read-modify-write pattern for Namecheap DNS updates to prevent record deletion.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono | 4.6+ | HTTP framework with host-based routing | Already in use, supports custom `getPath()` for multi-domain routing |
| node-acme-client | Latest | Let's Encrypt ACME protocol client | Most popular Node.js ACME library, simpler than certbot |
| node-cache | Latest | In-memory TTL cache | Feature-rich, automatic cleanup, simple API for domain mappings |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Bun.serve | 1.2+ | HTTP/HTTPS server | Already in use, but has SNI limitations for multi-domain SSL |
| Caddy | 2.x | Reverse proxy alternative | If SNI issues become blocking (automatic SSL, no code required) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hono getPath() | Separate Bun instances per domain | More infrastructure overhead, but works around SNI limitations |
| node-acme-client | acme.sh (shell script) | More mature but requires shell execution, less JavaScript-native |
| In-memory cache | Redis | Better for distributed systems but adds infrastructure for single-server setup |

**Installation:**
```bash
npm install node-cache
npm install node-acme-client
```

## Architecture Patterns

### Recommended Project Structure
```
apps/api/src/
├── redirect/           # Redirect server logic
│   ├── router.ts      # Host-based routing with Hono getPath()
│   ├── cache.ts       # node-cache instance for domain mappings
│   └── ssl.ts         # ACME client and certificate management
├── routes/
│   └── dns.ts         # DNS info and verification endpoints
└── services/
    └── namecheap.ts   # DNS configuration (update with read-modify-write)
```

### Pattern 1: Host-Based Routing with Hono

**What:** Use Hono's `getPath()` constructor option to route requests based on Host header
**When to use:** Multi-domain routing on single server instance
**Example:**
```typescript
// Source: https://hono.dev/docs/api/routing
const app = new Hono({
  getPath: (req) => {
    const url = new URL(req.url)
    const host = req.headers.get('host') || url.hostname
    // Route all requests with /{host}{pathname} pattern
    return `/${host}${url.pathname}`
  }
})

// Register domain-specific routes
app.get('/:domain/*', async (c) => {
  const domain = c.req.param('domain')
  const targetUrl = await getTargetUrl(domain) // from cache or DB

  if (!targetUrl) {
    return c.html('<html><body><h1>Domain registered but not configured</h1></body></html>')
  }

  const url = new URL(c.req.url)
  const redirectUrl = new URL(targetUrl)
  redirectUrl.pathname = url.pathname
  redirectUrl.search = url.search
  // Note: fragments are client-side only, not sent to server

  return c.redirect(redirectUrl.toString(), 301)
})
```

### Pattern 2: In-Memory Cache with TTL

**What:** Cache domain-to-URL mappings with automatic expiration
**When to use:** Reduce database queries for frequent redirect lookups
**Example:**
```typescript
// Source: https://www.npmjs.com/package/node-cache
import NodeCache from 'node-cache'

const domainCache = new NodeCache({
  stdTTL: 300, // 5 minutes default TTL
  checkperiod: 60, // Check for expired keys every 60s
})

async function getTargetUrl(domain: string): Promise<string | null> {
  // Check cache first
  const cached = domainCache.get<string>(domain)
  if (cached !== undefined) {
    return cached
  }

  // Cache miss - query database
  const record = await db.query.domains.findFirst({
    where: eq(domains.name, domain)
  })

  if (record?.targetUrl) {
    domainCache.set(domain, record.targetUrl)
    return record.targetUrl
  }

  return null
}
```

### Pattern 3: HTTP-01 ACME Challenge Handler

**What:** Serve ACME challenge responses at `.well-known/acme-challenge/{token}`
**When to use:** Automatic SSL certificate provisioning with Let's Encrypt
**Example:**
```typescript
// Source: https://github.com/publishlab/node-acme-client
import acme from 'node-acme-client'

// Create ACME client
const client = new acme.Client({
  directoryUrl: acme.directory.letsencrypt.production,
  accountKey: await acme.crypto.createPrivateKey()
})

// Handle HTTP-01 challenge
app.get('/.well-known/acme-challenge/:token', async (c) => {
  const token = c.req.param('token')
  const keyAuthorization = await getChallengeResponse(token)
  return c.text(keyAuthorization)
})

// Auto mode handles challenge automatically
const [key, cert] = await acme.auto({
  csr: csrBuffer,
  email: 'admin@example.com',
  termsOfServiceAgreed: true,
  challengePriority: ['http-01'], // Use HTTP-01 only
  challengeCreateFn: async (authz, challenge, keyAuthorization) => {
    // Store challenge for retrieval by .well-known route
    storeChallengeResponse(challenge.token, keyAuthorization)
  },
  challengeRemoveFn: async (authz, challenge) => {
    removeChallengeResponse(challenge.token)
  }
})
```

### Pattern 4: Namecheap DNS Read-Modify-Write

**What:** Always read existing DNS records before writing to prevent deletion
**When to use:** Any Namecheap DNS modification via API
**Example:**
```typescript
// Source: https://www.namecheap.com/support/api/methods/domains-dns/
async function addDnsRecord(domain: string, record: DnsRecord): Promise<void> {
  // Step 1: Read all existing records
  const existingRecords = await namecheap.getHosts(domain)

  // Step 2: Add new record to list
  const allRecords = [...existingRecords, record]

  // Step 3: Write all records back (setHosts overwrites everything)
  await namecheap.setHosts(domain, allRecords)
}
```

### Anti-Patterns to Avoid

- **Calling Namecheap setHosts with only new records** - Deletes all existing DNS records including MX, TXT, etc.
- **Using 302 redirects instead of 301** - Search engines won't transfer authority, breaks user expectations for permanent forwarding
- **Redirect loops** - Always validate target URL doesn't redirect back to source domain
- **Testing SSL directly in production** - Use Let's Encrypt staging environment first to avoid rate limits
- **Storing certificates in database** - File system with strict permissions is simpler and more performant

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ACME protocol implementation | Custom Let's Encrypt API client | node-acme-client | Complex protocol with account management, nonce handling, JWS signing |
| In-memory cache with TTL | Map + setTimeout cleanup | node-cache | Memory leaks, race conditions, inefficient cleanup |
| SSL certificate renewal | Manual cron job to check expiry | ACME client auto-renewal | Certificate monitoring, renewal timing (30 days before expiry), error handling |
| DNS propagation checking | ping/dig polling | Exponential backoff with timeout | Global DNS propagation is non-deterministic, needs smart retry logic |
| URL parsing/manipulation | String concatenation | URL API | Edge cases with paths, query strings, encoding, trailing slashes |

**Key insight:** SSL/TLS certificate management has decades of accumulated edge cases. Let's Encrypt rate limits (300 certificates per 3 hours per account) mean production mistakes are costly. Always use staging environment for testing.

## Common Pitfalls

### Pitfall 1: Bun Lacks SNI Callback for Multi-Domain SSL

**What goes wrong:** Bun.serve() doesn't support dynamic certificate selection based on SNI (Server Name Indication). You can only configure one certificate per server instance.

**Why it happens:** Bun Issue #17842 - SNI callback support is not yet implemented as of 2026. Node.js has `SNICallback` in tls options but Bun doesn't.

**How to avoid:**
- Option A: Run separate Bun server instances per domain (microservice architecture)
- Option B: Use Caddy as reverse proxy in front of Bun (handles SSL automatically)
- Option C: Implement HTTP-only redirect server, offload SSL to load balancer/CDN

**Warning signs:** SSL certificate errors when testing multiple registered domains

### Pitfall 2: Namecheap setHosts Destructively Overwrites All DNS Records

**What goes wrong:** Calling `setHosts` with only new A records deletes all existing MX, TXT, CNAME records for the domain.

**Why it happens:** Namecheap API design - setHosts is not additive, it's a complete replacement operation.

**How to avoid:** Always use read-modify-write pattern:
1. Call `getHosts` to fetch existing records
2. Merge new records with existing
3. Call `setHosts` with complete record set

**Warning signs:** Email stops working after DNS update, other services using CNAME/TXT records break

### Pitfall 3: Let's Encrypt Rate Limits Block Certificate Provisioning

**What goes wrong:** Hitting 300 new orders per 3 hours limit during testing, then unable to provision certificates in production.

**Why it happens:** Testing SSL provisioning directly against production Let's Encrypt API without using staging environment.

**How to avoid:**
- Use Let's Encrypt staging directory during development: `acme.directory.letsencrypt.staging`
- Switch to production only after verification
- Monitor rate limit usage via account dashboard

**Warning signs:** ACME client returns rate limit errors, can't provision new certificates for hours

### Pitfall 4: DNS Propagation Delays Break SSL Provisioning

**What goes wrong:** ACME HTTP-01 challenge fails because DNS A record hasn't propagated to Let's Encrypt's verification servers.

**Why it happens:** DNS propagation takes 24-48 hours in worst case, but Let's Encrypt verifies within minutes of challenge setup.

**How to avoid:**
- Configure DNS records during domain registration (Phase 4), not during first redirect request
- Implement DNS verification endpoint to confirm propagation before attempting SSL provisioning
- Add retry logic with exponential backoff for ACME challenges

**Warning signs:** ACME challenge fails with "connection refused" or "domain not found" errors

### Pitfall 5: URL Fragments Are Client-Side Only

**What goes wrong:** Redirecting `domain.com/#section` loses the `#section` fragment identifier.

**Why it happens:** Browsers never send fragments to server in HTTP requests. Server-side redirects can't preserve them.

**How to avoid:**
- Document that fragments are preserved by browsers automatically on 301 redirects
- Don't attempt to parse or manipulate fragments server-side (they're not in request)
- Modern browsers preserve fragments across redirects per HTTP spec

**Warning signs:** User complaints about anchor links not working after redirect

### Pitfall 6: Idempotent URL Updates Return Different Responses

**What goes wrong:** Updating URL to same value returns success first time, error second time (or vice versa).

**Why it happens:** Not checking current state before update, treating duplicate requests as errors.

**How to avoid:**
- Compare incoming URL with current database value
- If identical, return success immediately (no-op)
- Track state in response: `{"updated": false, "reason": "already_set"}`

**Warning signs:** API clients retry failed requests and get different responses

## Code Examples

Verified patterns from official sources:

### Complete Redirect Server with Cache

```typescript
// Source: https://hono.dev/docs/api/routing + https://www.npmjs.com/package/node-cache
import { Hono } from 'hono'
import NodeCache from 'node-cache'
import { db } from './db'
import { domains } from './db/schema'
import { eq } from 'drizzle-orm'

const cache = new NodeCache({
  stdTTL: 300, // 5 minutes
  checkperiod: 60,
})

const app = new Hono({
  getPath: (req) => {
    const url = new URL(req.url)
    const host = req.headers.get('host') || url.hostname
    return `/${host}${url.pathname}`
  }
})

// Unknown domain landing page
app.get('/', (c) => {
  const host = c.req.header('host') || 'unknown'
  return c.html(`
    <html>
    <head><title>Domain Available</title></head>
    <body>
      <h1>${host} is available for registration</h1>
      <p>Register this domain via <a href="https://api.x402names.com">x402names API</a></p>
    </body>
    </html>
  `)
})

// Multi-domain redirect handler
app.get('/:domain/*', async (c) => {
  const domain = c.req.param('domain')
  const fullPath = c.req.path.substring(domain.length + 2) // Remove /{domain}

  // Check cache
  let targetUrl = cache.get<string>(domain)

  if (!targetUrl) {
    // Cache miss - query database
    const record = await db.query.domains.findFirst({
      where: eq(domains.name, domain),
      columns: { targetUrl: true, status: true }
    })

    if (!record || record.status !== 'live') {
      // Registered but not configured
      return c.html(`
        <html>
        <head><title>${domain} - Not Configured</title></head>
        <body>
          <h1>This domain is registered but not configured yet</h1>
        </body>
        </html>
      `)
    }

    if (record.targetUrl) {
      targetUrl = record.targetUrl
      cache.set(domain, targetUrl)
    }
  }

  if (!targetUrl) {
    return c.html('<html><body><h1>Domain not configured</h1></body></html>')
  }

  // Build redirect URL preserving path and query string
  const url = new URL(c.req.url)
  const redirectUrl = new URL(targetUrl)
  redirectUrl.pathname = fullPath || '/'
  redirectUrl.search = url.search

  // 301 Permanent Redirect
  return c.redirect(redirectUrl.toString(), 301)
})

export default app
```

### URL Update Endpoint with Idempotency

```typescript
// Source: https://restfulapi.net/idempotent-rest-apis/
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { x402 } from '@x402/hono'

const updateSchema = z.object({
  targetUrl: z.string().url()
})

app.patch('/domains/:name/url',
  x402({ amount: '2.00', network: 'base-mainnet' }),
  zValidator('json', updateSchema),
  async (c) => {
    const domainName = c.req.param('name')
    const { targetUrl } = c.req.valid('json')
    const walletAddress = c.req.header('x-402-wallet-address')

    // Fetch current domain record
    const domain = await db.query.domains.findFirst({
      where: eq(domains.name, domainName)
    })

    if (!domain) {
      return c.json({ error: 'Domain not found' }, 404)
    }

    // Verify ownership
    if (domain.ownerWallet.toLowerCase() !== walletAddress?.toLowerCase()) {
      return c.json({ error: 'Only domain owner can update URL' }, 403)
    }

    // Idempotency: check if URL is already set to this value
    if (domain.targetUrl === targetUrl) {
      return c.json({
        success: true,
        updated: false,
        reason: 'url_already_set',
        domain: domainName,
        targetUrl
      })
    }

    // Update database
    await db.update(domains)
      .set({
        targetUrl,
        updatedAt: new Date()
      })
      .where(eq(domains.name, domainName))

    // Invalidate cache
    cache.del(domainName)

    return c.json({
      success: true,
      updated: true,
      domain: domainName,
      targetUrl
    })
  }
)
```

### DNS Configuration Endpoint

```typescript
// Source: https://www.namecheap.com/support/api/methods/domains-dns/
app.get('/domains/:name/dns', async (c) => {
  const domainName = c.req.param('name')

  const domain = await db.query.domains.findFirst({
    where: eq(domains.name, domainName)
  })

  if (!domain) {
    return c.json({ error: 'Domain not found' }, 404)
  }

  const serverIp = env.REDIRECT_SERVER_IP

  return c.json({
    domain: domainName,
    records: [
      {
        type: 'A',
        host: '@',
        value: serverIp,
        ttl: 300
      },
      {
        type: 'A',
        host: 'www',
        value: serverIp,
        ttl: 300
      }
    ],
    instructions: [
      'Add A record pointing @ to ' + serverIp,
      'Add A record pointing www to ' + serverIp,
      'DNS propagation may take 24-48 hours'
    ]
  })
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| certbot shell script | node-acme-client library | 2020+ | Native JavaScript, no shell execution, better error handling |
| 90-day Let's Encrypt certs | 45-day certs (May 2026) | In progress | Must implement automatic renewal, can't rely on manual processes |
| Manual DNS configuration | API-based DNS automation | 2024+ | Zero-touch provisioning, essential for agent-first APIs |
| express.js | Hono framework | 2023+ | 3-10x faster, Web Standard APIs, edge-ready |
| Map cache | LRU cache with TTL | 2022+ | Memory bounds, automatic eviction, production-safe |

**Deprecated/outdated:**
- **Greenlock/Greenlock Express** - Abandoned, last update 2021. Use node-acme-client instead.
- **HTTP-01 on port 80 only** - Still required by spec, but can redirect to HTTPS on port 443 for challenge verification.
- **DNS-01 for single domains** - Overcomplicated. Use HTTP-01 unless you need wildcard certificates.

## Open Questions

Things that couldn't be fully resolved:

1. **Bun SNI Support Timeline**
   - What we know: Issue #17842 open since Oct 2024, no milestone assigned
   - What's unclear: Whether Bun will implement SNICallback or recommend architectural alternatives
   - Recommendation: Plan for separate server instances per domain OR use Caddy reverse proxy

2. **Cache TTL Duration**
   - What we know: node-cache supports any TTL, common range is 60-600 seconds
   - What's unclear: Optimal balance between database load and URL update propagation delay
   - Recommendation: Start with 300 seconds (5 minutes), monitor and adjust based on usage patterns

3. **DNS Verification Timing**
   - What we know: Propagation can take 24-48 hours, but often completes in minutes
   - What's unclear: When to attempt SSL provisioning after DNS configuration
   - Recommendation: Implement verification endpoint that polls DNS resolution, timeout after 5 minutes, retry later

4. **Redirect Server Colocation**
   - What we know: Can add routes to existing Hono app OR run separate service
   - What's unclear: Performance implications of mixing API and redirect traffic
   - Recommendation: Start with same app (simpler), split if traffic patterns require isolation

## Sources

### Primary (HIGH confidence)
- [Hono Routing Documentation](https://hono.dev/docs/api/routing) - getPath() configuration
- [Hono Best Practices](https://hono.dev/docs/guides/best-practices) - Production deployment patterns
- [Let's Encrypt Challenge Types](https://letsencrypt.org/docs/challenge-types/) - HTTP-01 vs DNS-01
- [Let's Encrypt Rate Limits](https://letsencrypt.org/docs/rate-limits/) - Production limits and staging
- [Let's Encrypt 45-day Certificate Transition](https://letsencrypt.org/2025/12/02/from-90-to-45) - Upcoming changes May 2026
- [node-cache npm package](https://www.npmjs.com/package/node-cache) - API and TTL configuration
- [node-acme-client GitHub](https://github.com/publishlab/node-acme-client) - ACME implementation for Node.js

### Secondary (MEDIUM confidence)
- [Which ACME Challenge Type Should I Use?](https://shop.trustico.com/blogs/stories/which-acme-challenge-type-should-i-use-http-01-or-dns-01) - HTTP-01 vs DNS-01 comparison
- [URL Redirects Guide 2026](https://redirect.pizza/technical-guide-to-url-redirects-in-2026) - Best practices for 301 redirects
- [Bun HTTP Server Documentation](https://bun.com/docs/runtime/http/server) - TLS and hostname configuration
- [Bun SNI Support Issue #17842](https://github.com/oven-sh/bun/issues/17842) - SNI callback limitation
- [Bun TLS Configuration Guide](https://bun.sh/guides/http/tls) - Single certificate setup
- [Idempotency REST APIs](https://restfulapi.net/idempotent-rest-apis/) - State vs response distinction
- [Namecheap API Documentation](https://www.namecheap.com/support/api/methods/domains-dns/) - DNS methods
- [How to Create Memory Cache with TTL in Node.js](https://oneuptime.com/blog/post/2026-01-30-nodejs-memory-cache-ttl/view) - 2026 caching guide
- [FreeCodeCamp: Build Production-Ready Apps with Hono](https://www.freecodecamp.org/news/build-production-ready-web-apps-with-hono/) - Production patterns

### Tertiary (LOW confidence - WebSearch only)
- [DNS Propagation Timeframes](https://powerdmarc.com/how-long-does-it-take-for-dns-to-update/) - 24-48 hour estimates
- [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https) - Alternative to Bun SSL
- [URL Fragment Preservation](https://medium.com/@90mph/hash-fragments-and-browser-redirects-acf8e33cbaa5) - Browser behavior

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Hono and node-acme-client are verified through official documentation
- Architecture: MEDIUM - Patterns are proven but Bun SNI limitation requires workarounds
- Pitfalls: HIGH - Namecheap API behavior confirmed, Let's Encrypt rate limits documented, Bun SNI issue tracked

**Research date:** 2026-02-04
**Valid until:** 2026-03-04 (30 days - stable domain, but Let's Encrypt cert lifetime changing May 2026)

**Key uncertainties:**
- Bun SNI callback support timeline (architectural decision depends on this)
- Optimal cache TTL for production workload (requires measurement)
- SSL provisioning strategy given Bun limitations (may need Caddy or separate instances)
