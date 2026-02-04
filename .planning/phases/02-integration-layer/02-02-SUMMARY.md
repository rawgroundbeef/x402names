---
phase: 02-integration-layer
plan: 02
subsystem: payment-integration
tags: [x402, payment-middleware, replay-protection, sqlite, drizzle, hono]
requires:
  - 01-01-foundation-monorepo
  - 01-02-foundation-api
provides:
  - x402-payment-middleware
  - replay-protection-module
  - payment-records-persistence
affects:
  - 04-01-registration-flow (will consume payment middleware)
  - 04-02-registration-flow (payment verification)
tech-stack:
  added:
    - "@x402/hono@2.2.0"
    - "@x402/core@2.2.0"
    - "@x402/evm@2.2.0"
  patterns:
    - "x402 protocol payment middleware for Hono"
    - "EVM exact payment scheme with USDC"
    - "Atomic duplicate detection via SQLite UNIQUE constraint"
    - "Synchronous Drizzle ORM with bun:sqlite"
    - "Dependency injection for testability"
key-files:
  created:
    - apps/api/src/integrations/payment/middleware.ts
    - apps/api/src/integrations/payment/replay-protection.ts
    - apps/api/src/integrations/payment/__tests__/replay-protection.test.ts
    - apps/api/drizzle/0001_same_retro_girl.sql
  modified:
    - apps/api/src/db/schema.ts
    - apps/api/src/config/env.ts
    - apps/api/package.json
key-decisions:
  - decision: "payTo address configured per-route, not globally"
    rationale: "x402 PaymentOption includes payTo field - allows different receiving addresses per endpoint"
  - decision: "Use paymentMiddleware directly with configured server"
    rationale: "Simpler than paymentMiddlewareFromConfig - server already has scheme registered"
  - decision: "BunSQLiteDatabase<any> type parameter"
    rationale: "Allows test database instances without schema type constraint"
patterns-established:
  - "x402 middleware factory pattern with createPaymentMiddleware"
  - "Synchronous replay protection (no async/await with bun:sqlite)"
  - "DuplicatePaymentError with Object.setPrototypeOf for instanceof checks"
  - "In-memory SQLite for isolated payment tests"
duration: 347
completed: 2026-02-03
---

# Phase 2 Plan 02: x402 Payment Middleware and Replay Protection Summary

**One-liner:** x402 payment middleware with EVM exact scheme and SQLite-based atomic duplicate payment detection

## What Was Built

This plan established the payment integration layer for x402 protocol, enabling Hono routes to require USDC payment via EVM networks (Base Sepolia/Mainnet). The implementation provides payment middleware configuration, payment ID replay protection, and database persistence.

### Core Components

**1. Payment Middleware (`middleware.ts`)**
- `createPaymentMiddleware()` factory function for Hono integration
- Configures HTTPFacilitatorClient with custom facilitator URL
- Creates x402ResourceServer and registers EVM exact payment scheme
- Returns middleware factory that accepts route configurations
- Supports per-route payTo addresses (not global configuration)

**2. Replay Protection (`replay-protection.ts`)**
- `recordPayment()` - Synchronous payment storage with UNIQUE constraint enforcement
- `hasPaymentBeenUsed()` - Payment ID lookup for duplicate detection
- `DuplicatePaymentError` - Custom error with proper prototype chain for instanceof
- Dependency injection pattern (accepts db parameter) for testability
- Atomic duplicate detection via SQLite UNIQUE constraint (no race conditions)

**3. Database Schema**
- `paymentRecords` table with payment_id (UNIQUE), wallet_address, amount, network, domain, created_at
- Migration 0001_same_retro_girl.sql generated via drizzle-kit
- Supports both EVM networks (Base Sepolia eip155:84532, Base Mainnet eip155:8453)

**4. Environment Configuration**
- `X402_RECEIVING_ADDRESS` - Default receiving wallet (optional, can override per-route)
- `X402_FACILITATOR_URL` - x402 facilitator endpoint (default: https://x402.org/facilitator)
- `X402_NETWORK` - CAIP-2 network identifier (default: eip155:84532 for Base Sepolia)

### Implementation Details

**x402 SDK Integration:**
- Used `@x402/hono` for Hono middleware adapter
- `@x402/core/server` for HTTPFacilitatorClient and x402ResourceServer
- `@x402/evm/exact/server` for registerExactEvmScheme
- Confirmed actual package exports via node_modules inspection (different from initial docs)

**Replay Protection Strategy:**
- Synchronous API (no async/await) matching Drizzle's bun:sqlite behavior
- SQLite UNIQUE constraint catches duplicates atomically
- Error detection via "UNIQUE constraint failed" message matching
- Custom DuplicatePaymentError with Object.setPrototypeOf for proper instanceof checks

**Testing Approach:**
- In-memory SQLite database (`:memory:`) for test isolation
- Manual table creation via SQL in beforeEach (no migration runner in tests)
- 11 comprehensive tests covering:
  - Successful payment recording
  - Duplicate detection and error throwing
  - Payment ID lookup (used/unused)
  - All fields stored correctly
  - DuplicatePaymentError instanceof chain

## Commits

| Hash    | Message                                          | Files Changed |
|---------|--------------------------------------------------|---------------|
| a117db7 | feat(02-02): add payment records schema and x402 dependencies | 7 files |
| 9484633 | feat(02-02): add x402 payment middleware and replay protection | 2 files |
| 843d0fd | test(02-02): add replay protection tests         | 2 files |
| dc5070a | fix(02-02): relax BunSQLiteDatabase type parameter | 1 file |

**Total:** 4 atomic commits, 347 seconds (5.8 minutes)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed bun-types dev dependency**
- **Found during:** Task 1 TypeScript compilation
- **Issue:** TypeScript config requires bun-types but it wasn't in package.json
- **Fix:** `bun add -D bun-types` to satisfy tsconfig compilerOptions
- **Files modified:** apps/api/package.json
- **Commit:** a117db7

**2. [Rule 1 - Bug] Corrected middleware implementation approach**
- **Found during:** Task 2 implementation
- **Issue:** Initially tried to use paymentMiddlewareFromConfig with SchemeRegistration, but receivingAddress doesn't exist on FacilitatorConfig
- **Fix:** Inspected actual @x402 package exports, discovered payTo is per-route in PaymentOption, simplified to use paymentMiddleware directly with pre-configured server
- **Files modified:** apps/api/src/integrations/payment/middleware.ts
- **Commit:** 9484633

**3. [Rule 1 - Bug] Fixed BunSQLiteDatabase type parameter**
- **Found during:** Task 3 TypeScript verification
- **Issue:** `BunSQLiteDatabase` without type parameter caused type mismatch errors with test database instances
- **Fix:** Changed to `BunSQLiteDatabase<any>` to accept any schema type
- **Files modified:** apps/api/src/integrations/payment/replay-protection.ts
- **Commit:** dc5070a

## Dependencies Fulfilled

**Plan 02-01 (Namecheap registrar) modifications to env.ts:**
- Plan 02-01 ran in parallel and added NAMECHEAP_* and DOMAIN_MARKUP_PERCENT env vars
- Successfully merged both plans' env var additions (X402_* and NAMECHEAP_*)
- No conflicts - additive changes as expected

## Test Results

**All tests passing (43 total across 4 files):**

- **Replay protection tests:** 11 tests, 18 expect() calls
  - recordPayment success, duplicate detection, field storage
  - hasPaymentBeenUsed true/false cases
  - DuplicatePaymentError name, message, instanceof chain

- **Pre-existing tests:** 32 tests (health, migration, database)
  - No regressions from payment integration

**TypeScript compilation:**
- No errors in payment integration code
- Pre-existing test errors in migrate.test.ts and health.test.ts (from Phase 1)

## Verification Checklist

- [x] `bunx tsc --noEmit` compiles without errors (excluding pre-existing test errors)
- [x] `bun test` all tests pass (43 tests)
- [x] schema.ts contains paymentRecords with unique payment_id
- [x] Migration file 0001_same_retro_girl.sql exists in apps/api/drizzle/
- [x] middleware.ts exports createPaymentMiddleware
- [x] replay-protection.ts exports recordPayment, hasPaymentBeenUsed, DuplicatePaymentError
- [x] Duplicate payment_id throws DuplicatePaymentError (verified by tests)
- [x] @x402/hono, @x402/core, @x402/evm in package.json

## Next Phase Readiness

**Phase 4 Registration Flow can now:**
1. Apply payment middleware to /api/register endpoint
2. Configure route-specific payment requirements (payTo, price, network)
3. Record payment IDs to prevent replay attacks
4. Query payment history for audit/reconciliation

**Required for Phase 4:**
- X402_RECEIVING_ADDRESS must be set to actual wallet address
- X402_NETWORK should match deployment environment (Sepolia for test, Mainnet for prod)
- Database migration must be run: `bun run db:migrate`

**Integration pattern for Phase 4:**
```typescript
import { createPaymentMiddleware } from './integrations/payment/middleware';
import { env } from './config/env';

const paymentMiddleware = createPaymentMiddleware({
  facilitatorUrl: env.X402_FACILITATOR_URL,
  network: env.X402_NETWORK,
});

app.use(paymentMiddleware({
  'POST /api/register': {
    accepts: {
      scheme: 'exact',
      payTo: env.X402_RECEIVING_ADDRESS,
      price: '5.00', // $5 USDC
      network: env.X402_NETWORK,
    }
  }
}));
```

## Performance Notes

**Duration:** 347 seconds (5.8 minutes)
**Velocity:** ~86 seconds per task (4 commits including fix)

**Time breakdown estimate:**
- Task 1 (schema + dependencies): ~120s
- Task 2 (middleware + replay protection): ~100s
- Task 3 (tests): ~80s
- TypeScript fix: ~47s

**Efficiency factors:**
- x402 package export inspection added ~60s (necessary - docs were incomplete)
- Middleware approach iteration added ~40s (necessary - learned actual API)
- All fixes were auto-applied per deviation rules (no user checkpoints)

## Lessons Learned

**1. Always inspect actual package exports**
- Initial plan assumed @x402 exports matched research notes
- Reality: Had to check node_modules/.bun/@x402+*/dist/esm/index.d.mts
- Saved time by checking early before implementing

**2. SQLite UNIQUE constraint for atomic deduplication**
- No need for application-level locking or transactions
- Database handles race conditions via constraint
- Simple error message parsing to detect duplicates

**3. Synchronous Drizzle with bun:sqlite**
- No async/await needed (unlike other ORMs)
- Matches bun:sqlite's native synchronous API
- Simpler code, fewer footguns

**4. Dependency injection for testability**
- Accepting `db` parameter enables in-memory testing
- No need to mock database or file system
- Tests run fast (~30-40ms for 11 tests)

**5. Per-route payTo addresses**
- More flexible than global configuration
- Enables different receiving wallets for different services
- Important for future multi-tenant scenarios
