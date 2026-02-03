# Requirements: x402names

**Defined:** 2026-02-03
**Core Value:** Agent registers domain and points it at content with a single API call and USDC payment.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Domain Check

- [ ] **CHECK-01**: Agent can check if a domain is available
- [ ] **CHECK-02**: Availability response includes dynamic price in USDC based on TLD
- [ ] **CHECK-03**: Agent can retrieve list of supported TLDs with pricing

### Registration

- [ ] **REG-01**: Agent can register a domain by paying USDC via x402
- [ ] **REG-02**: Registered domain points at any user-specified URL (HTTP 301 redirect)
- [ ] **REG-03**: Registration is idempotent (same payment ID returns same result)
- [ ] **REG-04**: Registration tracks state transitions (pending → paid → registered → live)
- [ ] **REG-05**: Failed registrations after payment are retried automatically

### Domain Management

- [ ] **MGMT-01**: Agent can update where a domain points (x402 payment, small fee)
- [ ] **MGMT-02**: Agent can check registration status, owner, and current URL for any domain

### Infrastructure

- [ ] **INFRA-01**: Abstract registrar interface with Namecheap as first implementation
- [x] **INFRA-02**: SQLite database with WAL mode and migration system
- [ ] **INFRA-03**: x402 payment middleware via @openfacilitator/sdk
- [x] **INFRA-04**: Deployment support for Railway, Fly.io, and Docker self-host

### Hardening

- [ ] **HARD-01**: Rate limiting per IP and per wallet address
- [ ] **HARD-02**: Domain name validation (format, length, supported TLDs)
- [ ] **HARD-03**: Target URL validation (valid URL, http/https only, no localhost)
- [ ] **HARD-04**: Machine-readable error codes for all failure scenarios

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
| CHECK-01 | Phase 3 | Pending |
| CHECK-02 | Phase 3 | Pending |
| CHECK-03 | Phase 3 | Pending |
| REG-01 | Phase 4 | Pending |
| REG-02 | Phase 4 | Pending |
| REG-03 | Phase 4 | Pending |
| REG-04 | Phase 4 | Pending |
| REG-05 | Phase 4 | Pending |
| MGMT-01 | Phase 5 | Pending |
| MGMT-02 | Phase 3 | Pending |
| INFRA-01 | Phase 2 | Pending |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 2 | Pending |
| INFRA-04 | Phase 1 | Complete |
| HARD-01 | Phase 6 | Pending |
| HARD-02 | Phase 6 | Pending |
| HARD-03 | Phase 6 | Pending |
| HARD-04 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-02-03*
*Last updated: 2026-02-03 after roadmap creation*
