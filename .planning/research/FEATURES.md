# Features Research: Domain Registration APIs

**Project:** x402names
**Researched:** 2026-02-03
**Domain:** Agent-first domain registration service with x402 micropayments
**Confidence:** MEDIUM (based on training knowledge through January 2025, no live API access for verification)

## How Domain Registration APIs Work

### Standard Flow

**Availability Check → Purchase → Configure → Verify**

1. **Check availability** - Query registrar for domain status and pricing
2. **Initiate registration** - Submit domain + contact info + payment
3. **Registrar processes** - Sends request to registry (Verisign for .com, etc.)
4. **Configure DNS** - Set nameservers or DNS records
5. **Propagation** - Wait 2-5 minutes for DNS to propagate globally
6. **Verification** - Confirm domain is live and resolving

### Common API Patterns

**Synchronous vs Asynchronous Registration:**
- Most registrars use **asynchronous** patterns - registration returns a transaction ID, client polls for completion
- Synchronous (blocking until complete) is rare due to registry communication delays
- x402names consideration: Agents likely expect synchronous simplicity, but must handle async reality

**Authentication:**
- API keys (most common): Header-based `Authorization: Bearer {key}`
- IP whitelisting (reseller APIs): Additional security layer
- Rate limiting per API key

**Pricing:**
- Dynamic pricing APIs (check current cost before purchase)
- Registrar cost + margin = customer price
- Different pricing for registration vs renewal vs transfer

### Major Registrar API Capabilities

Based on training knowledge of Namecheap, GoDaddy, Cloudflare, Gandi APIs:

**Core Operations:**
- Domain availability check
- Domain registration
- Domain renewal
- Domain transfer (in/out)
- Contact information management
- Nameserver configuration
- DNS record management
- Domain locking/unlocking
- Authorization code retrieval
- Domain listing (get all domains for account)

**x402names Scope:** Only need availability check, registration, and DNS/nameserver management for v1.

## Table Stakes (Must Have for v1)

Features every domain registration API needs. Missing these = product is unusable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Domain availability check** | Must know if domain can be registered before attempting payment | LOW | Simple API call to registrar, cache briefly (30s) |
| **Price lookup** | User needs to know cost before paying | LOW | Bundled with availability check, add margin to registrar cost |
| **Domain registration** | Core value proposition | MEDIUM | Handle async registrar response, track transaction state |
| **WHOIS privacy** | Expected by default in 2025+ | LOW | Enable automatically, no user configuration needed |
| **Ownership verification** | Prove who owns a domain | LOW | Track wallet address that paid, expose in status endpoint |
| **DNS configuration** | Domain must point somewhere | MEDIUM | Two approaches: URL forwarding OR custom DNS records |
| **Domain status lookup** | Check registration state, DNS config | LOW | Query internal DB + registrar API if needed |
| **Update DNS/URL target** | Change where domain points | MEDIUM | Same complexity as initial DNS setup |
| **Error handling** | Domain taken, payment fails, registrar down | MEDIUM | Comprehensive error taxonomy needed |
| **Idempotency** | Prevent double-registration from retries | MEDIUM | Use x402 payment ID as idempotency key |
| **Basic validation** | Prevent invalid domain names | LOW | Regex + length checks before calling registrar |

### Critical Flow: Registration with Payment

**The registration flow must handle:**

1. **Pre-flight check** - Availability + price lookup
2. **Payment verification** - Validate x402 USDC payment received
3. **Registration attempt** - Call registrar API
4. **State tracking** - Store transaction: pending → success/failed
5. **Partial failure recovery** - Payment succeeded but registration failed (rare but critical)

**Edge case: Payment processed, registration fails**
- User paid, domain not registered
- Options: Refund USDC (complex) OR retry registration indefinitely OR credit account
- Recommendation: Track as "payment received, registration pending" and retry with exponential backoff

## Differentiators (x402names Unique Value)

What makes this different from Namecheap/GoDaddy/Cloudflare APIs.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Single-call registration** | `POST /register` with x402 payment = instant domain | HIGH | Payment verification + registration in one request |
| **No account required** | Wallet address = identity | LOW | Ownership tracked by payment wallet, no signup flow |
| **Agent-optimized responses** | JSON designed for LLM parsing | LOW | Clear error messages, structured responses, no HTML |
| **URL-direct mapping** | Point domain at any URL without DNS knowledge | MEDIUM | Abstraction over DNS: URL forwarding or CNAME magic |
| **Micropayment native** | Pay per operation in USDC, no billing cycle | LOW | x402 handles payment, no invoice/subscription logic |
| **Transparent pricing** | Cost = registrar_price + margin (shown upfront) | LOW | No hidden fees, pricing API returns breakdown |
| **Instant ownership proof** | Signature from wallet = proof of ownership | MEDIUM | Enable DNS updates by signing with original payment wallet |

### Agent-First Design Philosophy

**What agents need that humans don't:**

1. **Predictable errors** - Machine-readable error codes, not prose
2. **Idempotent operations** - Safe to retry any request
3. **Minimal state** - No session management, every request is independent
4. **Clear success criteria** - Boolean flags: `registered: true`, `live: true`
5. **No interactive flows** - No email verification, no captchas, no 2FA
6. **Deterministic pricing** - Price shouldn't change between check and register calls

## Anti-Features (Do NOT Build in v1)

Features to deliberately exclude with reasoning.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Auto-renewal** | Complexity: payment scheduling, wallet balance checks, notification on failure | Manual renewal only. Let agents decide renewal logic. Add in v1.1 if users demand it. |
| **Domain transfer IN** | Complexity: authorization codes, losing registrar coordination, 60-day lock | Only support fresh registrations. Transferring existing domains is different product. |
| **Custom nameservers** | Complexity: agents must run DNS servers, validation required | Use URL forwarding or our managed DNS. Nameserver support = v2+ feature. |
| **Email forwarding** | Scope creep: MX records, email infrastructure, spam handling | Out of scope. Domain points at URL, that's it. |
| **Subdomain management** | Complexity vs value: most agents want root domain | If needed, agents can use URL forwarding to their own subdomain service. |
| **Premium domains** | Complexity: aftermarket pricing, negotiation, escrow | Standard registration only. Premium = different flow, defer indefinitely. |
| **Bulk operations** | Premature: register 100 domains in one call | Use standard API in loop. Add bulk endpoints only if rate limiting becomes issue. |
| **Domain parking pages** | Scope creep: hosting default content | If domain has no URL mapping, show simple "Domain registered via x402names" page. No customization. |
| **Multi-year registration** | Complexity: pricing calculation, renewal tracking | One year only for v1. Multi-year = v1.1+ if demanded. |
| **Domain privacy toggle** | Confusion: privacy should just be ON | WHOIS privacy always enabled, not configurable. |
| **Contact info customization** | Compliance risk: fake contact data, registrar requirements | Use x402names registrar contact info. Custodial model = we are registrant. |
| **Domain locking UI** | Unnecessary: domains auto-locked at registrar | Handle locking at registrar level, don't expose to API. |

### The "Just Works" Principle

x402names should have **zero configuration**. Agent calls `/register`, domain works. No choosing nameservers, no WHOIS data entry, no DNS record management unless explicitly updating URL target.

## URL Forwarding Approaches

How to make a domain point at any URL without agents understanding DNS.

### Option 1: HTTP 301/302 Redirects (Simplest)

**How it works:**
1. Set domain's A record to x402names redirect server IP
2. Redirect server receives HTTP request for `example.com`
3. Looks up target URL in database: `example.com` → `https://ipfs.io/ipfs/Qm...`
4. Returns `HTTP 302 Found` with `Location: https://ipfs.io/ipfs/Qm...`
5. Browser follows redirect to target URL

**Pros:**
- Simple to implement (lightweight HTTP server + database lookup)
- Works for any target URL
- No DNS propagation delays (just HTTP routing)
- Supports HTTPS with wildcard cert `*.x402names.io` or SNI

**Cons:**
- URL in browser changes (redirect is visible)
- Preserves query params/paths by default
- SEO impact (301 is better than 302 for permanence)

**Implementation complexity:** LOW

### Option 2: DNS CNAME (If target is domain)

**How it works:**
1. If target URL is `https://example.target.com/path`, extract domain
2. Set CNAME record: `example.com` → `example.target.com`
3. Browser requests `example.com`, DNS resolves to `example.target.com` IP
4. HTTP request goes directly to target server

**Pros:**
- No redirect (transparent)
- Target server sees original domain in Host header

**Cons:**
- Only works if target URL is a domain (not IP, not path-specific)
- Target server must accept `example.com` in Host header
- Doesn't work for root domains (CNAME at apex is RFC violation, though some DNS providers allow)

**Implementation complexity:** LOW (if target is domain), N/A (if target has path component)

### Option 3: Proxy/Reverse Proxy (Full transparency)

**How it works:**
1. Set domain's A record to x402names proxy server
2. Proxy server receives request for `example.com`
3. Fetches content from target URL: `https://ipfs.io/ipfs/Qm...`
4. Returns content with original URL in browser

**Pros:**
- URL in browser stays `example.com` (fully transparent)
- Works for any target (IP, path, query params)
- Can modify content (inject headers, rewrite links)

**Cons:**
- High bandwidth cost (all traffic flows through proxy)
- Scaling challenge (proxy becomes bottleneck)
- HTTPS complexity (need SSL cert for every domain or wildcard)
- Caching required for performance
- Legal liability (serving content we don't control)

**Implementation complexity:** HIGH (infrastructure cost + legal risk)

### Option 4: Cloudflare Workers / Edge Functions

**How it works:**
1. Set domain's nameservers to Cloudflare
2. Cloudflare Worker intercepts requests
3. Worker fetches target URL and returns content
4. URL in browser stays `example.com`

**Pros:**
- Low latency (edge network)
- Scales automatically
- HTTPS built-in (Cloudflare cert)
- Lower cost than self-hosted proxy

**Cons:**
- Vendor lock-in (Cloudflare-specific)
- Worker execution limits (CPU time, memory)
- Still proxying all traffic (bandwidth costs)

**Implementation complexity:** MEDIUM

### Recommendation for x402names v1

**Use HTTP 301 redirects** for simplicity.

**Rationale:**
- Agents typically want to point domains at content URLs (IPFS gateways, x402.storage URLs)
- Redirect is transparent to agents (they just configure target URL)
- Low infrastructure cost (single redirect server, minimal traffic)
- Easy to implement and debug
- Upgrade path: Add proxy mode as premium feature later if users demand it

**Implementation:**
- Run Hono server with catch-all route: `app.all('*', redirectHandler)`
- Extract hostname from request: `req.headers.get('host')`
- Query database: `SELECT target_url FROM domains WHERE name = ?`
- Return `Response.redirect(targetUrl, 301)` (permanent) or `302` (temporary)
- Support both HTTP and HTTPS (Let's Encrypt wildcard cert or per-domain certs)

**DNS Setup:**
- A record: `example.com` → `{redirect_server_ip}`
- AAAA record: `example.com` → `{redirect_server_ipv6}` (optional but recommended)

## Validation Requirements

### Domain Name Validation Rules

**Format constraints (RFC standards):**
- Length: 1-63 characters per label, 253 characters total
- Characters: `a-z`, `0-9`, `-` (hyphen)
- Cannot start or end with hyphen
- Case-insensitive (normalize to lowercase)
- Labels separated by `.`
- TLD must be valid (check against public suffix list)

**Validation regex (basic):**
```regex
^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$
```

**Internationalized Domain Names (IDN):**
- Domains with Unicode characters (e.g., `münchen.com`)
- Must be converted to Punycode (`xn--mnchen-3ya.com`) before registrar API
- x402names decision: **Support IDN** (most registrars handle Punycode conversion)
- Validation: Check if domain contains non-ASCII, convert to Punycode, validate Punycode result

### TLD Support

**Common TLDs (well-supported by all registrars):**
- `.com`, `.net`, `.org`, `.io`, `.ai`, `.app`, `.dev`

**Geographic TLDs:**
- `.us`, `.uk`, `.ca`, `.au`, etc.
- Often require residency verification (complexity)

**New gTLDs:**
- `.xyz`, `.tech`, `.store`, `.crypto` (some are blockchain-based)

**x402names v1 recommendation:**
- **Support all TLDs that Namecheap supports** (registrar-driven)
- Check TLD availability via registrar API (dynamic list)
- Don't hardcode TLD whitelist (registrar catalog changes)
- Pricing varies by TLD (`.com` vs `.io` different costs)

**Implementation:**
```typescript
// Extract TLD from domain
const tld = domain.split('.').pop();

// Check if registrar supports this TLD
const available = await registrar.checkAvailability(domain);
if (!available.supported) {
  return { error: 'TLD_NOT_SUPPORTED', tld };
}
```

### URL Target Validation

When agent specifies where domain should point:

**Valid URL formats:**
- `https://example.com` (full URL)
- `http://192.168.1.1:8080` (IP + port)
- `https://ipfs.io/ipfs/Qm...` (IPFS gateway)

**Validation:**
- Must be valid URL (use `new URL()` constructor)
- Scheme must be `http://` or `https://` (no `ftp://`, `file://`)
- No localhost URLs (`localhost`, `127.0.0.1`) - pointless for public domain
- Max length: 2048 characters (browser limits)

**Edge case: Path preservation**
- If target is `https://example.com/page`, redirect should preserve path
- User visits `mydomain.com/foo` → redirect to `https://example.com/page/foo`?
- x402names decision: **No path preservation in v1** (too complex, edge cases)
- Redirect always goes to exact target URL specified

## Error Scenarios

Comprehensive taxonomy of what can go wrong.

### 1. Domain Availability Errors

| Error | When | HTTP Code | Agent Action |
|-------|------|-----------|--------------|
| `DOMAIN_ALREADY_REGISTERED` | Domain taken | 409 | Try different domain |
| `DOMAIN_INVALID_FORMAT` | Malformed domain name | 400 | Fix domain format |
| `TLD_NOT_SUPPORTED` | Registrar doesn't support TLD | 400 | Choose different TLD |
| `DOMAIN_RESERVED` | Reserved/premium domain | 403 | Choose different domain |
| `REGISTRAR_API_ERROR` | Upstream registrar API down | 503 | Retry later |

### 2. Payment Errors

| Error | When | HTTP Code | Agent Action |
|-------|------|-----------|--------------|
| `PAYMENT_NOT_FOUND` | x402 payment ID invalid | 404 | Check payment ID |
| `PAYMENT_INSUFFICIENT` | Paid less than domain cost | 402 | Pay correct amount |
| `PAYMENT_ALREADY_USED` | Payment used for another domain | 409 | New payment required |
| `PAYMENT_EXPIRED` | Payment older than 10 minutes | 410 | Create new payment |
| `PAYMENT_WRONG_CURRENCY` | Not USDC | 400 | Must pay in USDC |

### 3. Registration Errors

| Error | When | HTTP Code | Agent Action |
|-------|------|-----------|--------------|
| `DOMAIN_TAKEN_DURING_REGISTRATION` | Someone registered while processing | 409 | Payment refunded, try different domain |
| `REGISTRAR_REJECTED` | Registrar denied registration | 500 | Contact support |
| `REGISTRATION_TIMEOUT` | Registrar didn't respond in time | 504 | Check status endpoint |
| `PARTIAL_FAILURE_PAID_NOT_REGISTERED` | Payment cleared but registration failed | 500 | Retry automatic, contact support if persists |

### 4. DNS Configuration Errors

| Error | When | HTTP Code | Agent Action |
|-------|------|-----------|--------------|
| `INVALID_TARGET_URL` | Malformed target URL | 400 | Fix URL format |
| `DNS_PROPAGATION_PENDING` | Domain registered but DNS not live | 202 | Wait 2-5 minutes, check again |
| `DNS_UPDATE_FAILED` | Couldn't update DNS records | 500 | Retry |

### 5. Ownership Errors

| Error | When | HTTP Code | Agent Action |
|-------|------|-----------|--------------|
| `NOT_DOMAIN_OWNER` | Wallet didn't register this domain | 403 | Use correct wallet |
| `SIGNATURE_INVALID` | Ownership proof signature wrong | 401 | Re-sign with correct wallet |

### 6. Rate Limiting Errors

| Error | When | HTTP Code | Agent Action |
|-------|------|-----------|--------------|
| `RATE_LIMIT_EXCEEDED` | Too many requests from IP/wallet | 429 | Wait N seconds (in Retry-After header) |

### Critical: Partial Failure Handling

**Scenario:** Payment verified, funds deducted, registration call to registrar fails.

**Problem:** User paid but didn't get domain. Can't just fail and ignore.

**Solution options:**

1. **Automatic retry with exponential backoff**
   - Store transaction as `payment_received, registration_pending`
   - Background job retries registration every 1min, 5min, 15min, 1hr
   - Most failures are transient (registrar API hiccup)

2. **Manual intervention**
   - Alert x402names operator
   - Manually register domain or refund
   - Not scalable but acceptable for v1

3. **Refund to wallet**
   - Complex: need to hold USDC in contract, implement refund logic
   - Defer to v2+

**Recommendation for v1:**
- Implement automatic retry (option 1)
- Add manual intervention alert (option 2) as backup
- Transaction states: `pending` → `payment_verified` → `registration_pending` → `registered` → `dns_configured` → `live`
- Expose state in status endpoint so agent can poll

## Rate Limiting

Patterns for preventing abuse while allowing legitimate agent use.

### Threat Model

**Attack vectors:**
1. **Domain squatting** - Register thousands of domains to resell
2. **API abuse** - Spam availability checks to DOS registrar
3. **Payment spam** - Create fake payments to waste processing
4. **DNS update spam** - Constantly change domain targets

### Rate Limiting Strategy

**Tier 1: Per-IP rate limits (coarse)**
- Availability check: 60 requests/minute per IP
- Registration: 5 requests/minute per IP
- DNS update: 20 requests/minute per IP

**Tier 2: Per-wallet rate limits (fine)**
- Registration: 10 domains/hour per wallet
- DNS update: 100 updates/hour per wallet per domain

**Tier 3: Global rate limits (safety)**
- Total registrations: 1000/hour (protect registrar API quota)
- If exceeded, queue registrations and process in order

### Implementation

**Use standard rate limiting patterns:**
- Redis-backed rate limiter (shared across instances)
- Token bucket algorithm (allow bursts, throttle sustained abuse)
- Return `429 Too Many Requests` with `Retry-After` header

**Example response:**
```json
{
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Too many availability checks. Try again in 30 seconds.",
  "retry_after_seconds": 30,
  "limit": 60,
  "window": "60s"
}
```

### Allowlist for Trusted Agents

**Future consideration (v1.1+):**
- Agents with verified identity can request higher limits
- Requires reputation system or stake mechanism
- Not needed for v1 (standard limits sufficient)

## Agent Expectations

What programmatic consumers expect from a domain API.

### 1. Idempotency

**Every endpoint must be safe to retry.**

- Availability check: Naturally idempotent (read-only)
- Registration: Use x402 payment ID as idempotency key (same payment = same result)
- DNS update: Idempotent (setting URL to same value twice = no-op)
- Status check: Naturally idempotent (read-only)

**Implementation:**
```typescript
// Registration endpoint
const existingRegistration = await db.findByPaymentId(paymentId);
if (existingRegistration) {
  // Return existing result, don't re-register
  return { success: true, domain: existingRegistration.domain };
}
```

### 2. Predictable Errors

**Machine-readable error codes, consistent structure.**

```json
{
  "success": false,
  "error": {
    "code": "DOMAIN_ALREADY_REGISTERED",
    "message": "Domain example.com is not available",
    "details": {
      "domain": "example.com",
      "registered_at": "2026-01-15T10:30:00Z"
    }
  }
}
```

**Error taxonomy:**
- `4xx` errors: Agent can fix (bad input, insufficient payment)
- `5xx` errors: Server issue, agent should retry
- Error codes are constants (agents can switch/case on them)

### 3. Synchronous Where Possible

**Agents prefer blocking calls over polling.**

- Availability check: Synchronous (fast)
- Registration: **Appears synchronous** even if registrar is async
  - Block until registration completes (timeout 30s)
  - If registrar hasn't responded by timeout, return `202 Accepted` with status URL
  - Most registrations complete in <5 seconds

**Anti-pattern:** Return transaction ID, require agent to poll.
**Better pattern:** Block until complete, fall back to polling only if slow.

### 4. Clear Success Criteria

**Boolean flags for every state.**

```json
{
  "domain": "example.com",
  "registered": true,
  "dns_configured": true,
  "live": true,  // Domain is resolving globally
  "target_url": "https://ipfs.io/ipfs/Qm...",
  "owner_wallet": "0x..."
}
```

Agent can check `if (response.live)` without parsing complex state.

### 5. Minimal Authentication

**Wallet signature = proof of ownership.**

No API keys to manage, no OAuth flows.

- Registration: x402 payment proves intent (wallet address embedded)
- DNS update: Require signature from owner wallet
- Status check: Public (anyone can check any domain)

**Update flow:**
```json
POST /update-dns
{
  "domain": "example.com",
  "target_url": "https://new-target.com",
  "signature": "0x...",  // Sign("update:example.com:https://new-target.com", wallet_private_key)
  "wallet": "0x..."
}
```

Verify signature matches original registration wallet.

### 6. No State Between Requests

**Every request is independent.**

No sessions, no cookies, no "you must call X before Y" flows.

Agent can call any endpoint in any order (subject to ownership checks).

## WHOIS Privacy

### Industry Standard (as of 2025)

**Default privacy is now expected.**

- ICANN rules changed: registrars can redact personal data from WHOIS
- Most registrars offer free WHOIS privacy (Namecheap, Cloudflare, etc.)
- Users expect privacy ON by default, not something to enable

### x402names Approach

**Always-on privacy, not configurable.**

- Registrant contact: x402names (reseller contact info)
- Admin contact: x402names
- Tech contact: x402names
- No user email/phone exposed in WHOIS

**Rationale:**
- Custodial model: domains registered under our reseller account
- No user contact info collected (wallet address is identity)
- Simpler: one less thing agents have to configure

**WHOIS output:**
```
Registrant: x402names LLC
Registrant Email: domains@x402names.io
Admin Contact: x402names LLC
Tech Contact: x402names LLC
```

No mention of actual user/agent.

## MVP Feature Prioritization

For v1.0 milestone, prioritize in this order:

### Phase 1: Core Registration (MVP)
1. `GET /check` - Domain availability + price
2. `POST /register` - Payment verification + registration + DNS setup
3. `GET /status/:domain` - Check domain info
4. HTTP 301 redirect server (point domains at URLs)
5. Basic validation (domain format, TLD support)
6. Error handling (availability, payment, registration errors)

### Phase 2: Ownership & Updates
7. `POST /update-dns` - Change where domain points (signature verification)
8. Rate limiting (per-IP, per-wallet)
9. Idempotency (payment ID-based)

### Phase 3: Polish
10. DNS propagation status (is domain live yet?)
11. Retry logic for partial failures
12. Better error messages optimized for LLM parsing

## Deferred to Post-MVP

**Do not build in v1.0:**
- Auto-renewal (manual renewal only)
- Domain transfers (fresh registration only)
- Bulk operations (use API in loop)
- Custom nameservers (use our redirect/DNS)
- Email forwarding (out of scope)
- Premium domains (standard pricing only)
- Multi-year registration (1 year only)
- Parking pages (simple default page)

## Sources

**Confidence: MEDIUM**

Research based on training knowledge of domain registration APIs through January 2025. No live API documentation accessed due to tool restrictions.

**Known registrar APIs referenced (training knowledge):**
- Namecheap API (reseller interface patterns)
- GoDaddy Domains API (endpoint structure)
- Cloudflare Registrar API (modern practices)
- Gandi API (domain management patterns)

**Standards referenced:**
- RFC 1035 (Domain Name System)
- RFC 3490 (Internationalized Domain Names - IDNA)
- ICANN WHOIS policies (2024-2025 privacy rules)

**Verification needed:**
- Current registrar API capabilities (may have changed since training)
- Latest ICANN policies on WHOIS privacy
- Namecheap reseller API specific features
- Current best practices for rate limiting domain APIs

**Recommendation:** Validate registrar-specific details (Namecheap API endpoints, rate limits, pricing structure) during implementation phase by consulting current Namecheap API documentation.
