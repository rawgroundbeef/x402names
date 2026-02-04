---
phase: 05-url-forwarding
plan: 03
subsystem: api
tags: [x402, payment, domain-management, hono, drizzle, cache-invalidation]

# Dependency graph
requires:
  - phase: 05-01
    provides: DomainCache for invalidation after URL updates
  - phase: 02-02
    provides: Payment header parsing and replay protection
  - phase: 02-03
    provides: Domain database schema with ownerWallet and targetUrl fields
provides:
  - PATCH /domains/:name/url endpoint with $2.00 USDC flat fee
  - Domain URL update with ownership verification by wallet address
  - Cache invalidation after URL updates
  - Idempotent URL updates (same URL returns updated: false)
  - Payment replay protection for URL updates
affects: [06-hardening, domain-management, url-updates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Flat fee pricing for domain operations ($2.00 USDC for URL updates)"
    - "Wallet-based ownership verification via case-insensitive comparison"
    - "Idempotent updates with explicit feedback (updated: true/false)"
    - "Cache invalidation on successful updates"

key-files:
  created:
    - apps/api/src/routes/domains/url-update.ts
    - apps/api/src/routes/domains/__tests__/url-update.test.ts
  modified:
    - apps/api/src/routes/domains/index.ts
    - apps/api/src/index.ts

key-decisions:
  - "Flat $2.00 USDC fee for URL updates (vs dynamic pricing)"
  - "Ownership verified by comparing wallet addresses (case-insensitive)"
  - "Idempotent updates return explicit updated: false with reason"
  - "Cache invalidation happens after successful database update"
  - "Payment replay protection prevents reusing same payment"

patterns-established:
  - "URL update pattern: payment → ownership check → idempotency → update → cache invalidate"
  - "Wallet comparison is case-insensitive for ownership checks"
  - "Response includes previousUrl for audit trail"

# Metrics
duration: 2min
completed: 2026-02-04
---

# Phase 05 Plan 03: URL Updates Summary

**Domain owners update target URLs by paying $2.00 USDC with wallet-based ownership verification and cache invalidation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-04T17:48:39Z
- **Completed:** 2026-02-04T17:50:52Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- PATCH /domains/:name/url endpoint with $2.00 USDC flat fee
- Wallet-based ownership verification (only owner can update)
- Idempotent updates return updated: false when URL unchanged
- Cache invalidation ensures immediate reflection of changes
- Payment replay protection prevents double-spending
- 12 comprehensive tests covering all scenarios

## Task Commits

Each task was committed atomically:

1. **Task 1: URL update endpoint with payment and ownership verification** - `8702ea0` (feat)
2. **Task 2: URL update tests** - `b86b32f` (test)

## Files Created/Modified
- `apps/api/src/routes/domains/url-update.ts` - PATCH endpoint with payment verification, ownership check, idempotency, database update, cache invalidation
- `apps/api/src/routes/domains/__tests__/url-update.test.ts` - 12 tests covering success, idempotency, errors, cache invalidation, payment replay
- `apps/api/src/routes/domains/index.ts` - Wired URL update routes into domain routes
- `apps/api/src/index.ts` - Passed domainCache to createDomainRoutes

## Decisions Made

**1. Flat $2.00 USDC fee for URL updates**
- Rationale: Simple, predictable pricing. No need for dynamic fees based on domain value. Lower than registration cost ($13.18 for .com) but non-trivial to prevent abuse.

**2. Wallet-based ownership verification**
- Rationale: Only the wallet that registered the domain can update its URL. Case-insensitive comparison prevents issues with wallet address formatting.

**3. Idempotent updates return explicit feedback**
- Rationale: When setting same URL, return `updated: false` with reason `url_already_set` instead of error. Allows clients to safely retry without side effects.

**4. Cache invalidation after database update**
- Rationale: Ensures redirect server immediately reflects new URL. Cache is invalidated after successful update, not before (to maintain consistency).

**5. Payment replay protection**
- Rationale: Same payment can't be used for multiple updates. Prevents replay attacks where attacker reuses captured payment to change URLs.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - implementation proceeded smoothly following existing patterns from register endpoint.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Phase 5 URL Forwarding - 3 of 4 plans complete:**
- Plan 01: Multi-domain redirect server operational ✓
- Plan 02: DNS auto-configuration operational ✓
- Plan 03: URL updates operational ✓
- Plan 04: Domain status endpoint (next)

**Ready for:**
- Plan 04: Domain status endpoint for querying domain details
- Phase 6: Hardening (signature verification, replay protection improvements)

**Test coverage:**
- 138 tests passing (126 existing + 12 URL update)
- All existing tests still pass
- Comprehensive coverage of URL update scenarios

**No blockers:**
- URL update endpoint fully functional
- Cache invalidation working
- Payment replay protection in place
- Requirement MGMT-01 satisfied

---
*Phase: 05-url-forwarding*
*Completed: 2026-02-04*
