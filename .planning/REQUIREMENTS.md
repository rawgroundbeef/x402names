# Requirements: x402names

**Defined:** 2026-02-03
**Core Value:** Agent registers domain and points it at content with a single API call and USDC payment.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Domain Check

- [x] **CHECK-01**: Agent can check if a domain is available
- [x] **CHECK-02**: Availability response includes dynamic price in USDC based on TLD
- [x] **CHECK-03**: Agent can retrieve list of supported TLDs with pricing

### Registration

- [x] **REG-01**: Agent can register a domain by paying USDC via x402
- [x] **REG-02**: Registered domain points at any user-specified URL (HTTP 301 redirect)
- [x] **REG-03**: Registration is idempotent (same payment ID returns same result)
- [x] **REG-04**: Registration tracks state transitions (pending → paid → registered → live)
- [x] **REG-05**: Failed registrations after payment are retried automatically

### Domain Management

- [x] **MGMT-01**: Agent can update where a domain points (x402 payment, small fee)
- [x] **MGMT-02**: Agent can check registration status, owner, and current URL for any domain

### Infrastructure

- [x] **INFRA-01**: Abstract registrar interface with Namecheap as first implementation
- [x] **INFRA-02**: SQLite database with WAL mode and migration system
- [x] **INFRA-03**: x402 payment middleware via @x402/hono
- [x] **INFRA-04**: Deployment support for Railway, Fly.io, and Docker self-host

### Hardening

- [x] **HARD-01**: Rate limiting per IP and per wallet address
- [x] **HARD-02**: Domain name validation (format, length, supported TLDs)
- [x] **HARD-03**: Target URL validation (valid URL, http/https only, no localhost)
- [x] **HARD-04**: Machine-readable error codes for all failure scenarios

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Transfer

- **XFER-01**: Owner can claim domain and receive transfer auth code
- **XFER-02**: Owner proves ownership by signing with payment wallet

### Integration

- **INTG-01**: Register endpoints as x402jobs nodes
- **INTG-02**: Auto-renewal with payment scheduling

### Advanced DNS

- **DNS-01**: Subdomain management
- **DNS-02**: Custom DNS records (A, AAAA, MX)
- **DNS-03**: Path preservation on redirects

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Email forwarding | Not core to domain-points-at-URL story |
| Premium domain pricing | Standard pricing sufficient, aftermarket is different product |
| Bulk registration API | Use standard API in loop; add if rate limiting becomes issue |
| Domain parking pages | Not our product; domain either points somewhere or doesn't |
| Contact info customization | Custodial model — all domains under our registrant info |
| Mobile/web UI | API-first; agents are primary consumers |
| WHOIS privacy toggle | Always on by default, not configurable |
| Multi-year registration | 1 year only for v1; reduces pricing complexity |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CHECK-01 | Phase 3 | Complete |
| CHECK-02 | Phase 3 | Complete |
| CHECK-03 | Phase 3 | Complete |
| REG-01 | Phase 4 | Complete |
| REG-02 | Phase 4 | Complete |
| REG-03 | Phase 4 | Complete |
| REG-04 | Phase 4 | Complete |
| REG-05 | Phase 4 | Complete |
| MGMT-01 | Phase 5 | Complete |
| MGMT-02 | Phase 3 | Complete |
| INFRA-01 | Phase 2 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 2 | Complete |
| INFRA-04 | Phase 1 | Complete |
| HARD-01 | Phase 6 | Complete |
| HARD-02 | Phase 6 | Complete |
| HARD-03 | Phase 6 | Complete |
| HARD-04 | Phase 6 | Complete |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-02-03*
*Last updated: 2026-02-04 after Phase 6 completion*
