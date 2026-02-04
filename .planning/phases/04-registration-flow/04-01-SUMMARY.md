---
phase: 04-registration-flow
plan: 01
subsystem: job-infrastructure
tags: [jobs, queue, retry, registration, drizzle, sqlite]
dependency-graph:
  requires: [03-02]
  provides: [job-queue, registration-processor, retry-logic]
  affects: [04-02]
tech-stack:
  added: []
  patterns: [long-running-operations, exponential-backoff, factory-pattern, in-memory-queue]
key-files:
  created:
    - apps/api/src/lib/jobs/queue.ts
    - apps/api/src/lib/jobs/registration.ts
    - apps/api/drizzle/0002_rich_mandrill.sql
  modified:
    - apps/api/src/db/schema.ts
    - apps/api/src/config/env.ts
decisions:
  - title: In-memory job queue with setTimeout
    rationale: Simple async job processing without external dependencies. Sufficient for MVP, can be replaced with durable queue later.
    alternatives: [BullMQ, Redis queue, pg-boss]
    trade-offs: Jobs lost on restart, but acceptable for registration flow since payment validation ensures idempotency.
  - title: Synchronous Drizzle operations (.run()) with type assertions
    rationale: Drizzle's synchronous API is faster for SQLite. Type assertions needed when using BunSQLiteDatabase<any> due to TypeScript limitations.
    alternatives: [async operations with .execute(), typed database parameter]
    trade-offs: Type safety reduced but runtime behavior correct. Pattern matches existing codebase decisions.
  - title: 3-attempt exponential backoff with 2s and 4s delays
    rationale: Handles transient registrar failures. Short delays to keep registration responsive while allowing brief outages to resolve.
    alternatives: [linear backoff, longer delays, more attempts]
    trade-offs: May fail on extended outages, but user gets fast feedback and can retry.
metrics:
  duration: 207
  completed: 2026-02-04
---

# Phase 04 Plan 01: Registration Job Infrastructure Summary

**One-liner:** LRO job queue with exponential backoff retry processing domain registrations via registrar API.

## What Was Built

Created the asynchronous job processing infrastructure for domain registrations:

1. **Registration Jobs Table** (`registrationJobs`)
   - State tracking (processing, succeeded, failed)
   - Progress tracking (0-100%) with step descriptions
   - Retry metadata (attempts, nextRetryAt)
   - Payment correlation (paymentId, amountPaid)
   - Error details (error, errorCode, registrarOrderId)

2. **In-Memory Job Queue** (`apps/api/src/lib/jobs/queue.ts`)
   - setTimeout-based scheduling with optional delays
   - Active timer tracking for cleanup and testing
   - Exports: `enqueueJob`, `cancelJob`, `clearAllJobs`, `getActiveJobCount`

3. **Registration Processor** (`apps/api/src/lib/jobs/registration.ts`)
   - Three-step progress: payment_verified → registrar_submitted → completed
   - Calls `registrar.register()` with contact info from env vars
   - Creates domain record in domains table on success
   - Exponential backoff retry: 3 attempts with 2s and 4s delays
   - Marks failed jobs with error details after max attempts
   - Factory pattern: `createJobProcessor(registrar, db)` for DI

4. **Contact Info Configuration**
   - 9 new `REGISTRAR_CONTACT_*` environment variables
   - Sensible defaults suitable for domain registration service
   - `getDefaultContactInfo()` helper builds ContactInfo from env

## Verification Results

All success criteria met:

- ✅ registrationJobs table defined with state tracking, retry info, and payment details
- ✅ In-memory job queue schedules processing via setTimeout
- ✅ Registration processor calls registrar.register() and creates domain records on success
- ✅ Exponential backoff retry: 3 max attempts, delays of 2s and 4s
- ✅ Failed jobs marked with error and errorCode
- ✅ Contact info from env vars passed to registrar

Technical verification:

- ✅ TypeScript compiles without errors
- ✅ Migration generated: `0002_rich_mandrill.sql`
- ✅ Migration applied successfully
- ✅ All 87 existing tests pass
- ✅ No circular dependencies
- ✅ schema.ts exports `registrationJobs`
- ✅ env.ts includes all REGISTRAR_CONTACT_* variables

## Architecture Notes

**Long-Running Operation (LRO) Pattern:**

The registration flow implements the LRO pattern:
1. Registration endpoint (Plan 02) creates job and returns immediately
2. Job processor runs asynchronously in background
3. Client can poll status via job ID or domain name

**Retry Strategy:**

- Attempt 1: Immediate (0ms delay)
- Attempt 2: 2 seconds delay (2^1 * 1000ms)
- Attempt 3: 4 seconds delay (2^2 * 1000ms)
- After 3 attempts: Mark as permanently failed

This handles transient registrar API failures while keeping registration responsive.

**Job State Machine:**

```
processing (attempts < 3)
   ↓
processing (retry with backoff) → processing → failed (max attempts)
   ↓
succeeded (domain created)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Map.values() iteration for TypeScript compatibility**

- **Found during:** Task 2 - TypeScript compilation
- **Issue:** `for (const timer of activeTimers.values())` not supported without --downlevelIteration flag
- **Fix:** Changed to `activeTimers.forEach((timer) => { clearTimeout(timer); })`
- **Files modified:** apps/api/src/lib/jobs/queue.ts
- **Commit:** 963cf0e

**2. [Rule 2 - Missing Critical] Added type assertions for Drizzle operations**

- **Found during:** Task 2 - TypeScript compilation
- **Issue:** TypeScript couldn't infer registrationJobs schema types when using BunSQLiteDatabase<any>
- **Fix:** Added `as any` assertions to `.set()` and `.values()` calls to match existing codebase pattern
- **Files modified:** apps/api/src/lib/jobs/registration.ts
- **Commit:** 963cf0e
- **Rationale:** This is a known Drizzle TypeScript limitation. Runtime behavior is correct. Same pattern used in 02-02 decision: "BunSQLiteDatabase<any> type parameter allows test database instances without schema type constraint."

## Next Phase Readiness

**Phase 4 Plan 02 (Registration Endpoint) can proceed:**

✅ Job infrastructure ready:
- registrationJobs table available for creating jobs
- enqueueJob() available for scheduling
- createJobProcessor() factory ready for route initialization

✅ Dependencies available:
- DomainRegistrar interface for injection
- Database instance for job creation
- Payment validation from 03-02

**No blockers or concerns.**

## Key Learnings

1. **In-memory queue simplicity**: setTimeout-based queue is sufficient for MVP. No external dependencies. Can be replaced with durable queue (BullMQ, pg-boss) if job persistence becomes needed.

2. **Factory pattern for testability**: `createJobProcessor(registrar, db)` enables dependency injection. Tests can inject MockRegistrar and in-memory database.

3. **Synchronous Drizzle with SQLite**: Using `.run()` instead of `await .execute()` is faster for SQLite operations. Type assertions needed with `BunSQLiteDatabase<any>` but runtime behavior is correct.

4. **Contact info defaults**: Providing sensible defaults for all REGISTRAR_CONTACT_* vars means the system works out-of-box for development and testing.

## Commits

| Task | Commit | Files Changed |
|------|--------|---------------|
| 1. Registration jobs schema and contact config | 0aa742f | schema.ts, env.ts, migration SQL |
| 2. Job queue and registration processor | 963cf0e | queue.ts, registration.ts |

**Total duration:** 207 seconds (3.5 minutes)
