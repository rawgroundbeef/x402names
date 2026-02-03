# Project Research Summary

**Project:** x402names
**Domain:** Domain registration service with x402 micropayments
**Researched:** 2026-02-03
**Confidence:** MEDIUM

## Executive Summary

x402names is an agent-first domain registration service that combines domain registration via traditional registrars (Namecheap) with x402 micropayment verification. The recommended approach is a lightweight API service built on Hono + SQLite + @openfacilitator/sdk, using URL forwarding to map domains to any target URL. This is fundamentally a payment-gated orchestration service that wraps domain registrar APIs with blockchain payment verification.

The architecture centers on three critical flows: x402 payment verification, domain registration with Namecheap, and DNS configuration for URL forwarding. The system uses an abstract registrar interface pattern, enabling provider swapping while maintaining clean business logic. For v1, URL forwarding (HTTP 301 redirects) provides the simplest path to market, deferring more complex DNS management to future iterations. The custodial model (all domains registered under x402names) eliminates user account complexity while maintaining ownership tracking via wallet addresses.

Key risks cluster around payment-registration atomicity (payment succeeds but registration fails), SQLite persistence on PaaS platforms (ephemeral filesystems), and Namecheap sandbox-production differences. These are all addressable through proper state machine design, persistent volume configuration, and production smoke testing. The biggest unknown is @openfacilitator/sdk integration specifics, which must be validated before Phase 2 implementation.

## Key Findings

### Recommended Stack

The stack prioritizes simplicity and ESM-native Node.js tooling. Hono provides a lightweight (~12KB), deployment-agnostic HTTP framework with excellent TypeScript support. better-sqlite3 offers synchronous SQLite access with superior performance over async wrappers. The @openfacilitator/sdk handles x402 payment verification, though exact API surface requires verification.

**Core technologies:**
- **Hono v4.x**: HTTP API framework — lightweight, ESM-native, deployment-agnostic (runs on Node.js, Bun, Cloudflare Workers)
- **better-sqlite3 v9.x**: SQLite database — synchronous API, faster than async wrappers, battle-tested in production
- **@openfacilitator/sdk**: x402 payment verification — handles USDC payment requests/verification (API requires validation)
- **Native fetch**: HTTP client — Node.js 18+ built-in, no axios needed
- **zod**: Input validation — TypeScript-native schema validation with type inference
- **fast-xml-parser**: XML parsing — for Namecheap API responses (lightweight, ESM-compatible)

**Key architectural constraint:** No ORM, no CommonJS dependencies, no heavyweight frameworks. Direct SQL, native Node.js features, and minimal dependencies enable fast startup, easy debugging, and predictable behavior.

**Critical gap:** @openfacilitator/sdk documentation inaccessible during research. Middleware API signature, payment proof format, and retry logic must be verified before implementing payment flows.

### Expected Features

Domain registration services have clear table stakes (availability check, registration, DNS config) versus differentiators (single-call registration, no-account model, agent-optimized responses). The research identified several anti-features to explicitly avoid in v1.

**Must have (table stakes):**
- Domain availability check with pricing
- Domain registration with payment verification
- WHOIS privacy (always enabled, not configurable)
- DNS configuration (point domain at target URL)
- Domain status lookup
- Update target URL (change where domain points)
- Error handling with machine-readable codes
- Idempotency (safe retries using payment ID as key)
- Domain name validation (prevent invalid formats)

**Should have (competitive differentiators):**
- Single-call registration (payment + registration in one API call)
- No account required (wallet address = identity)
- Agent-optimized responses (clear errors, structured JSON, no HTML)
- URL-direct mapping (point at any URL without DNS knowledge)
- Micropayment native (pay per operation, no billing cycles)
- Transparent pricing (registrar cost + margin shown upfront)
- Instant ownership proof (wallet signature = ownership)

**Defer (v2+):**
- Auto-renewal (complexity: payment scheduling, balance checks)
- Domain transfers (different product, adds authorization code flows)
- Custom nameservers (agents must run DNS servers)
- Email forwarding (scope creep: MX records, email infrastructure)
- Subdomain management (complexity vs value for v1)
- Premium domains (aftermarket pricing, escrow)
- Bulk operations (add if rate limiting becomes issue)
- Multi-year registration (1 year only for v1)

**Agent-first design principles:** Predictable errors, idempotent operations, minimal state, clear success criteria, no interactive flows, deterministic pricing.

### Architecture Approach

The system follows a layered architecture with clear separation between HTTP handling (Hono), business logic (domain service), external integrations (registrar interface, payment verification), and persistence (SQLite). The abstract registrar interface is the key architectural pattern, isolating provider-specific code and enabling testing with mocks.

**Major components:**
1. **HTTP API (Hono)** — Request routing, middleware chain (error handler, logger, x402 auth), route handlers for domains
2. **x402 Middleware** — Payment verification wrapper around @openfacilitator/sdk, sets wallet address on context
3. **Domain Service** — Business logic orchestration, database transactions wrapping registrar calls, error handling
4. **Registrar Interface** — Abstract IRegistrar with checkAvailability, registerDomain, setURLForwarding methods
5. **Namecheap Adapter** — Concrete implementation using native fetch + XML parsing, handles API quirks
6. **Database Service** — SQLite client with prepared statements, migration runner, transaction support
7. **Config Manager** — Environment-aware configuration with validation (zod), fail-fast on startup

**Data flow:** HTTP request → x402 middleware (payment verification) → route handler → domain service (business logic + DB transaction) → registrar adapter (external API call) → database service (persistence).

**URL forwarding approach:** For v1, use registrar's built-in URL forwarding (Namecheap URL301 records) rather than custom DNS. Simpler, immediate, no proxy infrastructure needed. Tradeoff: limited to HTTP redirects, URL changes in browser. Upgrade path exists for custom DNS in v2.

**Transaction safety:** Payment verification and domain registration cannot be truly atomic (payment is on-chain, registration is API call). Solution: state machine approach with automatic retry for transient failures, manual intervention system for payment-received-but-registration-failed cases.

### Critical Pitfalls

Research identified 8 critical pitfalls that must be addressed in v1, with payment-registration atomicity and SQLite persistence being the highest priority.

1. **Payment-Registration Atomicity Failure** — Payment clears but domain registration fails, leaving customer charged with no domain. Prevention: State machine (payment_verified → registration_pending → registered → failed), retry with exponential backoff, manual intervention alerts, use payment transaction hash as idempotency key.

2. **SQLite on Ephemeral Filesystem** — Container restart wipes all data. Prevention: Persistent volume mount (Railway volume, Fly.io mounts), enable WAL mode, automated hourly backups to S3/R2, startup verification checks, consider Litestream for continuous replication.

3. **Namecheap Sandbox vs Production Differences** — Code works in sandbox but fails in production due to undocumented differences (rate limits, validation strictness, DNS behavior). Prevention: Document all differences, production smoke tests with real domains, canary registrations on first deploy, environment-aware validation, error code monitoring.

4. **DNS Propagation Expectation Gap** — Customer registers domain, immediately tries to visit it, gets DNS error, thinks service is broken. Prevention: Clear UX messaging ("propagation takes 5-30 minutes"), DNS propagation checker updating status, email notification when live, show estimated time remaining.

5. **x402 Payment Replay Attacks** — Attacker captures payment proof and replays it to register multiple domains for price of one. Prevention: Nonce-based idempotency (payment can only be used once), payment-to-domain binding in metadata, amount verification, time-bound payments (15 minute expiry), leverage @openfacilitator/sdk's built-in replay protection.

6. **Namecheap API Rate Limiting** — Surge of requests exceeds rate limits, causing cascading failures. Prevention: Queue-based registration with limiter (15 req/min under Namecheap limit), rate limiter with backoff on 429 errors, status page showing queue position, burst protection per IP, monitoring and alerting on queue depth.

7. **URL Forwarding HTTPS Certificate Issues** — Domain forwards to HTTPS URL but registrar's forwarding service shows certificate warnings. Prevention: Test Namecheap URL forwarding with HTTPS targets before launch, consider alternative (A record to your redirect service with Cloudflare SSL), document redirect behavior.

8. **ICANN Registrant Data Requirements** — Registration fails because required contact information is missing or invalid. Prevention: Use consistent business info as registrant (custodial model), enable WHOIS privacy on all registrations, validate before API call, note TLD-specific requirements.

## Implications for Roadmap

Based on research findings, the recommended phase structure follows dependency order: foundation → external integrations → business logic → HTTP API → production hardening.

### Phase 1: Foundation & Database
**Rationale:** All other components depend on configuration and persistence. Must establish reliable data layer before building on top.

**Delivers:**
- Environment configuration with validation (config/index.ts)
- SQLite database client with WAL mode enabled
- Migration system for schema evolution
- Error handling infrastructure (custom error classes, global middleware)

**Addresses features:**
- Not user-facing, but enables all subsequent phases

**Avoids pitfalls:**
- SQLite on ephemeral filesystem (proper volume configuration)
- Concurrent write limitations (WAL mode)

**Build order:**
1. Config loader with zod validation
2. Database client + migrations
3. Error handling utilities

**Research flag:** Standard patterns, no phase research needed.

### Phase 2: Registrar Integration
**Rationale:** Registrar interface is the core domain knowledge. Building this early with mocks enables TDD for business logic.

**Delivers:**
- Abstract IRegistrar interface
- Mock registrar for testing
- Namecheap adapter with XML parsing
- Factory pattern for registrar selection

**Addresses features:**
- Domain availability check
- Domain registration API calls
- URL forwarding configuration

**Avoids pitfalls:**
- Namecheap sandbox vs production differences (document all quirks)
- API timeout handling (aggressive timeouts + retries)
- TLD-specific pricing and requirements

**Build order:**
1. IRegistrar interface definition
2. Mock implementation
3. Namecheap adapter
4. Factory + configuration

**Research flag:** NEEDS PHASE RESEARCH. Namecheap API specifics (endpoint URLs, XML schemas, error codes, required fields) must be validated from current documentation. Sandbox testing should document observed behavior.

### Phase 3: Payment Integration
**Rationale:** Payment verification must be functional before building registration flows. This is a blocking dependency.

**Delivers:**
- x402 middleware wrapping @openfacilitator/sdk
- Payment verification logic
- Payment recording in database
- Replay attack prevention

**Addresses features:**
- x402 payment verification
- Idempotency (payment ID as key)
- Instant ownership proof (wallet signature)

**Avoids pitfalls:**
- x402 payment replay attacks (nonce-based idempotency)
- Payment amount mismatch (verification before registration)
- Double-spend protection

**Build order:**
1. Research @openfacilitator/sdk API surface
2. Implement x402 middleware
3. Payment recording + idempotency checks
4. Integration tests with mock payments

**Research flag:** NEEDS PHASE RESEARCH. @openfacilitator/sdk API is unknown. Must verify middleware signature, payment proof format, context variables, retry behavior before implementation.

### Phase 4: Domain Service (Business Logic)
**Rationale:** With registrar interface and payment verification complete, implement the core workflows.

**Delivers:**
- Domain availability check
- Domain registration with atomicity handling
- Target URL updates
- Domain status queries
- State machine for registration flow
- Transaction safety patterns

**Addresses features:**
- Single-call registration (payment + registration orchestration)
- Domain name validation
- Error handling with machine-readable codes
- Transparent pricing (registrar cost + margin)

**Avoids pitfalls:**
- Payment-registration atomicity failure (state machine + retry)
- Domain name validation edge cases (strict regex + TLD checks)
- Race conditions (database-level locking)

**Build order:**
1. Validation utilities (domain format, URL format)
2. Availability check service method
3. Registration service method with state machine
4. Update service method
5. Transaction rollback logic

**Research flag:** Standard patterns, no phase research needed. Well-documented state machine and transaction patterns apply directly.

### Phase 5: HTTP API
**Rationale:** Expose business logic via Hono endpoints. With service layer complete, this is straightforward mapping.

**Delivers:**
- GET /domains/:name/availability
- POST /domains/:name/register (x402-protected)
- GET /domains/:name/status
- PUT /domains/:name/target (x402-protected)
- GET /health

**Addresses features:**
- Agent-optimized responses (clear JSON structure)
- No account required (wallet from payment = identity)
- Rate limiting (per-IP, per-wallet)

**Avoids pitfalls:**
- DNS propagation expectation gap (clear status messaging)

**Build order:**
1. Hono app setup + middleware chain
2. Domain route handlers (wire to service layer)
3. Health check endpoint
4. Integration tests (HTTP request/response)

**Research flag:** Standard patterns, no phase research needed. Hono middleware patterns are well-established.

### Phase 6: Production Hardening
**Rationale:** With MVP complete, address operational concerns for reliable production service.

**Delivers:**
- Persistent volume configuration (Railway/Fly.io)
- Automated database backups to S3/R2
- Backup restore testing
- DNS propagation checker (background job)
- Production smoke tests
- Monitoring and alerting setup
- Deployment documentation

**Addresses features:**
- Not user-facing, but ensures reliability

**Avoids pitfalls:**
- SQLite on ephemeral filesystem (volume verification)
- Database backup failures (automated backups + restore tests)
- Namecheap sandbox vs production (smoke tests)

**Build order:**
1. Configure persistent volumes
2. Implement backup system with verification
3. DNS propagation checker
4. Production deployment + smoke test
5. Monitoring setup

**Research flag:** Platform-specific details may need research. Railway and Fly.io volume configuration, backup strategies, and deployment best practices should be verified from current platform docs.

### Phase Ordering Rationale

This ordering follows strict dependency chains:
- **Foundation first** because everything depends on config + database
- **Registrar before payment** because registration logic needs registrar interface for testing, and registration is the domain core
- **Payment before business logic** because domain service orchestrates both registrar and payment
- **Business logic before HTTP** because route handlers are thin wrappers around service methods
- **Hardening last** because it requires working system to harden

**Key architectural insight:** The abstract registrar interface enables parallel work. Once the interface is defined, business logic can be built against mocks while Namecheap adapter is being implemented. This accelerates Phase 2-4 timeline.

**Why this grouping:** Phases align with architectural layers (foundation, external integrations, business logic, HTTP, operations). This makes each phase independently testable and deliverable.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 2 (Registrar Integration):** Namecheap API requires verification of current endpoint URLs, XML response schemas, error codes, required fields, rate limits, sandbox vs production differences. The research identified patterns but specific details need validation from official docs.

- **Phase 3 (Payment Integration):** @openfacilitator/sdk API is completely unknown. Must research middleware signature, payment proof format, context variables set by middleware, retry behavior, replay protection mechanisms before implementing payment flows.

- **Phase 6 (Production Hardening):** Railway and Fly.io deployment specifics (volume configuration, environment variables, health checks) may have changed since training cutoff. Verify current platform documentation for volume mounting, backup capabilities, and deployment best practices.

Phases with standard patterns (skip research-phase):

- **Phase 1 (Foundation):** Config management, SQLite setup, and error handling use well-established Node.js patterns. No novel integration needed.

- **Phase 4 (Business Logic):** State machine design, transaction handling, and validation are universal software patterns. Domain service can be built using standard techniques.

- **Phase 5 (HTTP API):** Hono middleware and routing patterns are well-documented. HTTP layer is straightforward mapping of service methods to endpoints.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Hono and better-sqlite3 well-understood, but @openfacilitator/sdk API unknown. Package versions based on training cutoff (Jan 2025), should verify current releases. |
| Features | HIGH | Domain registration feature expectations are universal across registrars. Agent-first design principles well-established. Table stakes vs differentiators clearly identified. |
| Architecture | HIGH | Layered architecture with abstract registrar interface follows proven patterns. Transaction safety and state machine approaches are standard. URL forwarding strategy is sound. |
| Pitfalls | MEDIUM | Payment atomicity, SQLite persistence, and DNS propagation are universal concerns with known solutions. Namecheap-specific quirks and x402 SDK behavior need validation. |

**Overall confidence:** MEDIUM

The architecture is sound and the feature set is well-scoped. Main uncertainty comes from external integrations (@openfacilitator/sdk, Namecheap API specifics) that couldn't be verified during research. These gaps are addressable through targeted phase research and don't represent fundamental risks.

### Gaps to Address

Critical gaps requiring validation during planning/implementation:

- **@openfacilitator/sdk API surface:** Exact middleware function signature, payment proof format, context variables, error handling patterns, replay protection behavior. This is a blocking gap for Phase 3. Resolution: Check npm page, GitHub repo, or example code for SDK usage patterns.

- **Namecheap API current version:** Endpoint URLs, XML response schemas, error codes, required contact fields, rate limits, sandbox behavior. Medium-priority gap for Phase 2. Resolution: Review official Namecheap API documentation and test in sandbox.

- **Package versions:** All versions based on training data (Jan 2025). Should verify `npm view <package> version` before installation to ensure compatibility and get latest stable releases.

- **Railway/Fly.io volume features:** Persistent volume configuration syntax and backup capabilities may have evolved. Low-priority gap for Phase 6. Resolution: Check current platform documentation when configuring production deployment.

Non-blocking gaps that can be resolved during implementation:

- **TLD-specific requirements:** Different TLDs have different rules (.us requires US address, .ca requires NEXUS token). Can be addressed as TLD support expands beyond initial .com/.net/.org focus.

- **Namecheap rate limits:** Exact rate limits per endpoint. Can be discovered through testing and monitoring in production.

- **DNS propagation timing:** Actual propagation delays vary by TLD and nameserver. Can be refined based on production monitoring.

## Sources

### Primary (HIGH confidence)
- Domain registration industry patterns (RFC 1035 DNS standards, ICANN policies)
- SQLite best practices (WAL mode, transaction handling, backup strategies)
- Node.js 18+ built-in features (native fetch, crypto.randomUUID)
- TypeScript + ESM configuration patterns

### Secondary (MEDIUM confidence)
- Hono framework patterns (based on training knowledge through Jan 2025)
- better-sqlite3 usage patterns (synchronous API, prepared statements)
- Namecheap API structure (inferred from typical domain registrar APIs, unable to verify current docs)
- Railway and Fly.io deployment patterns (based on training knowledge, may have evolved)

### Tertiary (LOW confidence)
- @openfacilitator/sdk behavior (API surface unknown, inferred from x402 protocol patterns)
- Namecheap sandbox vs production differences (common patterns identified but specifics need verification)
- Current package versions (listed versions from training cutoff, should verify with npm)

### Research methodology
Research was conducted without web access or API documentation verification. Findings based on:
- Domain registration industry knowledge (registrar patterns, DNS, WHOIS)
- Modern Node.js ecosystem patterns (ESM, TypeScript, Hono)
- Database transaction and state machine design patterns
- x402 protocol concepts (HTTP 402, USDC micropayments)

**Key limitation:** Unable to verify current API documentation for @openfacilitator/sdk or Namecheap. These must be validated during implementation phases.

---
*Research completed: 2026-02-03*
*Ready for roadmap: yes*
