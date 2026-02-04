---
phase: 04-registration-flow
plan: 02
subsystem: api
tags: [registration, x402, payment, lro, usdc, hono, drizzle, idempotency]

dependency-graph:
  requires:
    - phase: 04-01
      provides: [job-queue, registration-processor, retry-logic]
    - phase: 03-02
      provides: [domain-validation, tld-pricing, availability-check]
    - phase: 02-02
      provides: [payment-replay-protection]
  provides:
    - Registration endpoint (POST /domains/register) with x402 payment verification
    - Payment amount validation against dynamic TLD pricing
    - LRO status endpoint (GET /registrations/:jobId/status)
    - Idempotent registration via payment ID hashing
    - Payer wallet extraction from payment header
  affects: [05-url-forwarding, 06-hardening]

tech-stack:
  added: []
  patterns: [x402-payment-header-parsing, payment-amount-validation, lro-pattern, idempotent-registration]

key-files:
  created:
    - apps/api/src/routes/domains/register.ts
    - apps/api/src/routes/registrations/status.ts
    - apps/api/src/routes/registrations/index.ts
    - apps/api/src/routes/domains/__tests__/register.test.ts
    - apps/api/src/routes/registrations/__tests__/status.test.ts
  modified:
    - apps/api/src/routes/domains/index.ts
    - apps/api/src/index.ts

decisions:
  - title: Parse x402 payment header directly instead of using middleware
    rationale: Need full control over dynamic TLD-based pricing validation
  - title: Hash payment header for idempotency key
    rationale: Ensures same payment returns same job without exposing payment details
  - title: Validate payment amount against TLD pricing before accepting
    rationale: Prevent registration attempts with insufficient payment
  - title: Defer signature verification to Phase 6 (HARD-05)
    rationale: Focus on core registration flow first, add cryptographic verification in hardening phase

patterns-established:
  - "Payment header parsing: Extract payer wallet and amount from decoded x402 header"
  - "Dynamic pricing validation: Compare payment amount against getTldPricing() before processing"
  - "LRO polling: Return 202 Accepted with jobId/statusUrl, status endpoint returns processing/succeeded/failed"
  - "Idempotency: Hash payment header to generate payment ID, check for existing job"

metrics:
  duration: 267
  completed: 2026-02-04
---

# Phase 4 Plan 2: Registration Endpoint Summary

**POST /domains/register with x402 payment validation, dynamic TLD pricing verification, and LRO status polling for agent-facing domain registration**

## Performance

- **Duration:** 4 min 27 sec (267 seconds)
- **Started:** 2026-02-04T21:36:35Z
- **Completed:** 2026-02-04T21:41:02Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Registration endpoint validates payment amount against dynamic TLD pricing before accepting
- Payer wallet extracted from x402 payment header becomes domain owner
- Idempotent registration via payment ID hashing (same payment returns same jobId)
- LRO status endpoint provides processing/succeeded/failed states with progress tracking
- 15 comprehensive tests (9 for registration, 6 for LRO status) - all passing
- Full app integration with graceful shutdown cleanup

## Task Commits

Each task was committed atomically:

1. **Tasks 1-2: Registration endpoint and LRO status with app wiring** - `20c05ab` (feat)
   - Registration endpoint with x402 payment validation
   - LRO status endpoint with processing/succeeded/failed states
   - Main app wiring with job processor and graceful shutdown

2. **Task 3: Tests for registration and status endpoints** - `c8d2147` (test)
   - 9 registration endpoint tests (validation, payment, idempotency)
   - 6 LRO status endpoint tests (all states, 404 handling)

## Files Created/Modified

- `apps/api/src/routes/domains/register.ts` - POST /domains/register endpoint with payment validation
- `apps/api/src/routes/registrations/status.ts` - GET /registrations/:jobId/status LRO endpoint
- `apps/api/src/routes/registrations/index.ts` - Registration routes factory
- `apps/api/src/routes/domains/index.ts` - Mount register routes with jobProcessor dependency
- `apps/api/src/index.ts` - Wire job processor, registration routes, clearAllJobs on shutdown
- `apps/api/src/routes/domains/__tests__/register.test.ts` - 9 comprehensive registration tests
- `apps/api/src/routes/registrations/__tests__/status.test.ts` - 6 LRO status tests

## Decisions Made

1. **Parse x402 payment header directly instead of using middleware**
   - Rationale: Need full control over dynamic TLD-based pricing validation. Middleware would apply global pricing, but registration needs to validate payment amount against the specific TLD being registered.

2. **Hash payment header for idempotency key**
   - Rationale: SHA-256 hash of entire payment header ensures same payment always returns same jobId without exposing payment details or requiring database lookup before validation.

3. **Validate payment amount against TLD pricing before accepting**
   - Rationale: Prevents registration attempts with insufficient payment. Returns 402 with required amount in error detail so agents can retry with correct amount.

4. **Defer signature verification to Phase 6 (HARD-05)**
   - Rationale: Focus on core registration flow first. HARD-05 TODO comment documents that payment headers are decoded but not cryptographically verified against facilitator. Phase 6 hardening will add server-side signature verification via x402 verify functions.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all planned work completed without obstacles.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 5 (URL Forwarding):**
- Registration creates domain records with optional targetUrl field
- Domain status endpoint available at `/domains/:domain/status`
- LRO artifactUrl points to domain status for agents to retrieve final state

**Documented for Phase 6 (Hardening):**
- HARD-05 TODO: Add x402 payment signature verification via facilitator
- Currently payment headers are decoded but signatures not verified server-side

**Test Coverage:**
- 102 total tests passing across all endpoints
- Registration flow fully tested (payment validation, idempotency, error cases)
- No regressions in existing functionality

---
*Phase: 04-registration-flow*
*Completed: 2026-02-04*
