# Roadmap: x402names v1.0

## Overview

Build an agent-first domain registration API where agents pay USDC to register domains and point them at any URL. Six phases deliver the complete service: foundation infrastructure, external integrations, domain operations, registration flow with payment, URL forwarding, and production hardening.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Database, config, error handling, deployment scaffolding
- [x] **Phase 2: Integration Layer** - Registrar interface and x402 payment middleware
- [ ] **Phase 3: Domain Check & Management** - Availability checks and status lookup
- [ ] **Phase 4: Registration Flow** - Domain registration with payment verification
- [ ] **Phase 5: URL Forwarding** - Redirect server and DNS configuration
- [ ] **Phase 6: Production Hardening** - Rate limiting, validation, error codes

## Phase Details

### Phase 1: Foundation
**Goal**: Development environment ready with database and deployment scaffolding
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-02, INFRA-04
**Success Criteria** (what must be TRUE):
  1. SQLite database initializes with WAL mode and migration system
  2. Environment configuration loads from .env or environment variables
  3. Application starts successfully in development mode
  4. Deployment configuration exists for Railway, Fly.io, and Docker
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md -- Monorepo scaffold, env config, database layer with migrations (completed 2026-02-03)
- [x] 01-02-PLAN.md -- Hono server, deployment configs, test suite (completed 2026-02-03)

### Phase 2: Integration Layer
**Goal**: External integrations ready for business logic to consume
**Depends on**: Phase 1
**Requirements**: INFRA-01, INFRA-03
**Success Criteria** (what must be TRUE):
  1. Abstract registrar interface defined with Namecheap as first implementation
  2. Mock registrar implementation available for testing without API calls
  3. x402 payment middleware verifies payment proofs from request headers
  4. Payment verification rejects duplicate payment IDs (replay protection)
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md -- Abstract registrar interface, Namecheap adapter, mock registrar (completed 2026-02-03)
- [x] 02-02-PLAN.md -- x402 payment middleware, replay protection, payment records schema (completed 2026-02-03)

### Phase 3: Domain Check & Management
**Goal**: Agents can check domain availability and query domain status
**Depends on**: Phase 2
**Requirements**: CHECK-01, CHECK-02, CHECK-03, MGMT-02
**Success Criteria** (what must be TRUE):
  1. Agent can check if a domain name is available via API call
  2. Availability response includes USDC price based on TLD
  3. Agent can retrieve list of supported TLDs with pricing
  4. Agent can check registration status, owner wallet, and current URL for any domain
  5. All endpoints return structured JSON with machine-readable error codes
**Plans**: 2 plans

Plans:
- [ ] 03-01-PLAN.md — Domain validation, TLD pricing config, RFC 9457 error framework, TLD listing endpoint
- [ ] 03-02-PLAN.md — Availability check endpoint, domain suggestions, domain status endpoint

### Phase 4: Registration Flow
**Goal**: Agents can register domains by paying USDC via x402
**Depends on**: Phase 3
**Requirements**: REG-01, REG-02, REG-03, REG-04, REG-05
**Success Criteria** (what must be TRUE):
  1. Agent can register an available domain by including x402 payment proof
  2. Registration is idempotent (same payment ID returns same result, no duplicate charges)
  3. Registration tracks state transitions (pending → paid → registered → live)
  4. Failed registrations after payment are automatically retried with backoff
  5. Successful registration stores domain, owner wallet, and target URL in database
**Plans**: TBD

Plans:
- [ ] TBD during planning

### Phase 5: URL Forwarding
**Goal**: Registered domains redirect visitors to target URLs
**Depends on**: Phase 4
**Requirements**: MGMT-01, REG-02 (implementation detail)
**Success Criteria** (what must be TRUE):
  1. Registered domain returns HTTP 301 redirect to target URL when visited
  2. Redirect server handles multiple domains from database configuration
  3. DNS configuration documented for pointing domains at redirect server
  4. Domain owner can update target URL by paying small fee via x402
  5. URL update is idempotent and tracks state changes
**Plans**: TBD

Plans:
- [ ] TBD during planning

### Phase 6: Production Hardening
**Goal**: API is production-ready with validation and rate limiting
**Depends on**: Phase 5
**Requirements**: HARD-01, HARD-02, HARD-03, HARD-04
**Success Criteria** (what must be TRUE):
  1. Rate limiting enforced per IP address and per wallet address
  2. Domain name validation rejects invalid formats, lengths, and unsupported TLDs
  3. Target URL validation rejects malformed URLs, non-http/https schemes, and localhost
  4. All error responses include machine-readable error codes
  5. Common error scenarios documented with example responses
**Plans**: TBD

Plans:
- [ ] TBD during planning

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/2 | Complete | 2026-02-03 |
| 2. Integration Layer | 2/2 | Complete | 2026-02-03 |
| 3. Domain Check & Management | 0/2 | Not started | - |
| 4. Registration Flow | 0/TBD | Not started | - |
| 5. URL Forwarding | 0/TBD | Not started | - |
| 6. Production Hardening | 0/TBD | Not started | - |

---
*Last updated: 2026-02-04*
