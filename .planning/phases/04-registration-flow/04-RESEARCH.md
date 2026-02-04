# Phase 4: Registration Flow - Research

**Researched:** 2026-02-04
**Domain:** Payment-gated domain registration with LRO pattern
**Confidence:** HIGH

## Summary

Phase 4 implements payment-gated domain registration following the x402.jobs Long Running Operation (LRO) pattern. The existing codebase provides strong patterns: Hono routes with factory injection, Drizzle ORM with synchronous bun:sqlite, RFC 9457 error handling, and the @x402/hono payment middleware. The domain registration table already exists with status tracking fields (pending, paid, registered, live, failed). The DomainRegistrar interface has a register() method that returns transactionId and orderId.

The LRO pattern requires returning 202 Accepted with jobId, statusUrl, and retryAfterSeconds, then providing a status endpoint that returns processing/succeeded/failed states. For background job processing with retries, simple in-memory queue with setTimeout is sufficient for MVP, with future migration path to BullMQ if needed.

**Primary recommendation:** Use existing patterns (factory routes, Drizzle synchronous DB, RFC 9457 errors). Implement LRO with in-memory job tracking table. Return 202 Accepted from POST /domains/register, poll via GET /registrations/:jobId/status. Use exponential backoff retry (3 attempts: 1s, 2s, 4s delays).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @x402/hono | 2.2.0 | Payment middleware | Official x402 Hono integration, handles payment verification |
| @x402/core | 2.2.0 | Payment types & server | Core x402 protocol types and server implementation |
| @x402/evm | 2.2.0 | EVM payment scheme | EVM/USDC payment support on Base Sepolia |
| Drizzle ORM | 0.36.4 | Database ORM | Type-safe ORM for bun:sqlite, already in use |
| bun:sqlite | (built-in) | SQLite database | Bun's native SQLite driver, synchronous operations |
| Hono | 4.6.14 | Web framework | Fast, lightweight web framework, already in use |
| Zod | 4.3.6 | Request validation | Schema validation with type inference, already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tldts | 7.0.22 | Domain parsing | Domain validation (already used in Phase 3) |
| envalid | 8.0.0 | Environment config | Type-safe env vars (already configured) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory job queue | BullMQ + Redis | BullMQ adds Redis dependency and complexity; in-memory is simpler for MVP with <100 jobs/day. Migrate if scale requires persistence. |
| Synchronous DB | Async DB driver | bun:sqlite is synchronous by design, fast enough for SQLite workload. No need to change. |
| Manual LRO | @azure/core-lro | Azure package is overkill; simple custom implementation matches x402.jobs spec exactly. |

**Installation:**
```bash
# All dependencies already installed
# No new packages needed for Phase 4
```

## Architecture Patterns

### Recommended Project Structure
```
src/routes/
├── domains/
│   ├── index.ts           # Factory for domain routes
│   ├── check.ts           # Domain availability (Phase 3)
│   ├── status.ts          # Domain status (Phase 3)
│   └── register.ts        # NEW: Registration with x402 payment
└── registrations/
    ├── index.ts           # Factory for registration status routes
    └── status.ts          # NEW: LRO status polling endpoint

src/lib/
└── jobs/
    ├── registration.ts    # NEW: Registration job processor with retry logic
    └── queue.ts           # NEW: Simple in-memory job queue
```

### Pattern 1: x402 Payment Middleware Integration
**What:** Apply payment middleware to protected routes using factory pattern
**When to use:** Any route requiring payment before execution
**Example:**
```typescript
// src/routes/domains/register.ts
import { Hono } from 'hono';
import { createPaymentMiddleware } from '../../integrations/payment/middleware';
import { env } from '../../config/env';

export function createRegisterRoutes(registrar: DomainRegistrar, db: BunSQLiteDatabase) {
  const router = new Hono();

  // Create payment middleware
  const paymentMW = createPaymentMiddleware({
    facilitatorUrl: env.X402_FACILITATOR_URL,
    network: env.X402_NETWORK,
  });

  // Apply middleware to POST /domains/register
  router.post(
    '/',
    paymentMW({
      'POST /domains/register': {
        accepts: {
          scheme: 'exact',
          payTo: env.X402_RECEIVING_ADDRESS,
          price: '0.00', // Dynamic pricing - will be calculated from domain
          network: env.X402_NETWORK,
        }
      }
    }),
    async (c) => {
      // Payment verified - settlement response available in context
      // Implementation: extract payment data, create job, return 202
    }
  );

  return router;
}
```

### Pattern 2: LRO 202 Accepted Response
**What:** Return 202 Accepted with job status URL per x402.jobs spec
**When to use:** Operations that take >500ms or require async processing
**Example:**
```typescript
// Based on: https://www.x402.jobs/docs/long-running-resources
// Return 202 Accepted
return c.json({
  jobId: job.id,
  statusUrl: `/registrations/${job.id}/status`,
  retryAfterSeconds: 2,
  message: 'Registration initiated - payment verified'
}, 202);

// Status endpoint returns one of three states:
// 1. processing: { state: 'processing', progress: 33 }
// 2. succeeded: { state: 'succeeded', artifactUrl: '/domains/example.com', response: 'Domain registered successfully' }
// 3. failed: { state: 'failed', error: 'Registrar unavailable', code: 'registrar_timeout' }
```

### Pattern 3: Database-First Job Queue (Simple)
**What:** Use database table as job queue with in-memory processor
**When to use:** MVP with predictable low volume (<100 jobs/day)
**Example:**
```typescript
// src/db/schema.ts - Add registration_jobs table
export const registrationJobs = sqliteTable('registration_jobs', {
  id: text('id').primaryKey(), // UUID
  domainName: text('domain_name').notNull(),
  ownerWallet: text('owner_wallet').notNull(),
  paymentId: text('payment_id').notNull().unique(),
  targetUrl: text('target_url'),
  state: text('state', { enum: ['processing', 'succeeded', 'failed'] }).notNull(),
  progress: integer('progress').default(0), // 0-100
  error: text('error'),
  errorCode: text('error_code'),
  attempts: integer('attempts').default(0),
  nextRetryAt: integer('next_retry_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

// src/lib/jobs/queue.ts - In-memory processor
const activeJobs = new Map<string, ReturnType<typeof setTimeout>>();

export function enqueueJob(job: JobData) {
  db.insert(registrationJobs).values(job).run();
  scheduleJobProcessing(job.id);
}

function scheduleJobProcessing(jobId: string, delayMs = 0) {
  const timeout = setTimeout(() => processJob(jobId), delayMs);
  activeJobs.set(jobId, timeout);
}
```

### Pattern 4: Exponential Backoff Retry
**What:** Retry failed operations with exponentially increasing delays
**When to use:** Network calls to external services (Namecheap API)
**Example:**
```typescript
// src/lib/jobs/registration.ts
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

async function processRegistrationJob(jobId: string) {
  const job = db.select().from(registrationJobs).where(eq(registrationJobs.id, jobId)).get();

  try {
    // Step 1: Payment already verified (33% progress)
    updateJobProgress(jobId, 33);

    // Step 2: Submit to registrar (66% progress)
    updateJobProgress(jobId, 66);
    const result = await registrar.register(domain, years, contactInfo);

    // Step 3: Mark as registered (100% progress)
    updateJobProgress(jobId, 100);
    markJobSucceeded(jobId, result.orderId);

  } catch (error) {
    const nextAttempt = job.attempts + 1;

    if (nextAttempt >= MAX_ATTEMPTS) {
      markJobFailed(jobId, error.message, 'max_retries_exceeded');
    } else {
      // Exponential backoff: 2^attempts * baseDelay
      const delayMs = Math.pow(2, nextAttempt) * BASE_DELAY_MS;
      scheduleRetry(jobId, nextAttempt, delayMs);
    }
  }
}

// Backoff schedule: attempt 0→1s, attempt 1→2s, attempt 2→4s
```

### Pattern 5: Idempotency via Payment ID
**What:** Ensure same payment returns same result, no duplicate charges
**When to use:** All payment-triggered operations
**Example:**
```typescript
// Check if payment already used
const existingJob = db
  .select()
  .from(registrationJobs)
  .where(eq(registrationJobs.paymentId, paymentId))
  .get();

if (existingJob) {
  // Return existing job status (idempotent)
  return c.json({
    jobId: existingJob.id,
    statusUrl: `/registrations/${existingJob.id}/status`,
    retryAfterSeconds: 2,
    message: 'Registration already in progress'
  }, 202);
}

// Also check payment_records table (from Phase 2)
if (hasPaymentBeenUsed(db, paymentId)) {
  // Find associated domain/job
  const payment = db.select().from(paymentRecords)
    .where(eq(paymentRecords.paymentId, paymentId)).get();

  // Return problem details if payment used but job not found
  return createProblemResponse(c, 409, 'error:payment_already_used',
    'Payment Already Used', 'This payment has already been processed');
}
```

### Anti-Patterns to Avoid
- **Returning 200 OK immediately:** Registration takes 2-10 seconds with Namecheap API. Use 202 Accepted + LRO pattern.
- **Polling database continuously:** Use scheduled retries with backoff instead of busy-waiting.
- **Creating domain record before payment settles:** Payment verification happens before job creation. Settlement response contains payer wallet.
- **Storing sensitive contact info:** ContactInfo needed for Namecheap API but shouldn't be stored in our DB. Keep only domain, owner, payment data.
- **Synchronous payment verification:** x402 middleware handles async verification. Don't block route handler.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Payment verification | Custom signature verification | @x402/hono middleware | Handles EIP-712 signature verification, settlement, replay protection |
| Domain validation | Regex-only validation | validateDomain() + tldts | Already handles RFC 1035, label length, subdomain rejection |
| Error responses | Custom error format | createProblemResponse() | RFC 9457 compliance already implemented |
| Job persistence | Custom queue implementation | Drizzle schema + in-memory scheduler | Database as queue is proven pattern for low volume |
| Retry logic | Manual setTimeout chains | Exponential backoff helper | Prevents thundering herd, handles jitter |
| UUID generation | Math.random() | crypto.randomUUID() | Built-in, cryptographically secure |

**Key insight:** The x402 middleware handles the complex payment verification (signature validation, settlement, replay protection). Our code only needs to extract verified payment data and create the registration job. Don't re-implement payment flow.

## Common Pitfalls

### Pitfall 1: Payment Middleware Context Access
**What goes wrong:** Not knowing how to access verified payment data after middleware runs
**Why it happens:** x402 middleware documentation doesn't clearly show context variables
**How to avoid:** The SettleResponse contains `payer` (wallet address), `transaction` (tx hash), `network`. Access pattern unclear from docs, but based on Hono middleware patterns, likely `c.get('x402:payment')` or similar. CHECK THE ACTUAL MIDDLEWARE SOURCE OR EXAMPLES.
**Warning signs:** TypeScript errors when trying to access payment data. Need to verify actual context key used by @x402/hono.

### Pitfall 2: Dynamic Pricing with x402
**What goes wrong:** Middleware config has static price, but domain prices vary by TLD
**Why it happens:** PaymentRequirements.amount is set in middleware config, not per-request
**How to avoid:** Two options:
  1. **Pre-check flow:** Require GET /domains/check first, then use that price in middleware config (user-facing)
  2. **Calculate in middleware:** Use route middleware factory that reads domain from request body and sets price dynamically
**Warning signs:** All domains charge same amount regardless of TLD

### Pitfall 3: Job State Race Conditions
**What goes wrong:** Job processed twice because in-memory queue and database out of sync
**Why it happens:** setTimeout doesn't know about database state changes
**How to avoid:**
  - Check job state from database at start of processJob()
  - Only process if state is 'processing' and attempts < max
  - Use database as source of truth, not in-memory map
**Warning signs:** Duplicate registrar API calls, multiple domain records for same payment

### Pitfall 4: LRO Polling Never Completes
**What goes wrong:** Status endpoint always returns "processing", job stuck
**Why it happens:** Background processor crashed, job not retried, no error state set
**How to avoid:**
  - Add job timeout (e.g., 5 minutes)
  - Mark jobs as failed if nextRetryAt is in past and state still processing
  - Add health check endpoint showing job processor status
**Warning signs:** Jobs created but never complete, no failed states

### Pitfall 5: Idempotency Implementation Gaps
**What goes wrong:** Same payment creates multiple jobs or charges twice
**Why it happens:** Checking only one table (jobs OR payments) instead of both
**How to avoid:**
  1. Check registrationJobs.paymentId UNIQUE constraint
  2. Check paymentRecords.paymentId (from replay protection)
  3. Record payment BEFORE creating job (atomic transaction)
  4. Return existing job if found, not error
**Warning signs:** SQLite UNIQUE constraint violations in logs

### Pitfall 6: ContactInfo Requirements
**What goes wrong:** Registration fails because missing or invalid contact information
**Why it happens:** Namecheap requires full contact details (name, address, phone, email) for all four contact types
**How to avoid:**
  - Document that registration requires contact info (not just domain + payment)
  - Validate contact info format before calling registrar
  - Use default/placeholder contact info for agent registrations (check Namecheap policies)
  - Store contact requirement in Phase 4 context decisions
**Warning signs:** Namecheap API returns validation errors about missing contact fields

### Pitfall 7: Bun SQLite Async vs Sync Confusion
**What goes wrong:** Using await on Drizzle operations that are synchronous
**Why it happens:** Most ORMs are async, but bun:sqlite Drizzle is synchronous
**How to avoid:**
  - Use `.run()` for INSERT/UPDATE (returns void)
  - Use `.get()` for single row (returns T | undefined)
  - Use `.all()` for multiple rows (returns T[])
  - Don't await these methods - they're synchronous
**Warning signs:** TypeScript errors, operations returning immediately not promises

## Code Examples

Verified patterns from existing codebase and x402 documentation:

### Domain Registration Route with Payment Middleware
```typescript
// src/routes/domains/register.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createPaymentMiddleware } from '../../integrations/payment/middleware';
import { validationErrorHook } from '../../lib/errors';
import { validateDomain } from '../../lib/validation/domain';
import { getTldPricing } from '../../config/tlds';
import type { DomainRegistrar } from '../../integrations/registrar/types';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

const registerSchema = z.object({
  domain: z.string().min(1),
  targetUrl: z.string().url().optional(),
});

export function createRegisterRoutes(
  registrar: DomainRegistrar,
  db: BunSQLiteDatabase<any>
) {
  const router = new Hono();

  // Payment middleware configured per route
  const paymentMW = createPaymentMiddleware({
    facilitatorUrl: env.X402_FACILITATOR_URL,
    network: env.X402_NETWORK,
  });

  router.post(
    '/',
    // First validate request body
    zValidator('json', registerSchema, validationErrorHook),
    // Then verify payment (middleware)
    paymentMW((c) => {
      // Dynamic price based on domain in request
      const { domain } = c.req.valid('json');
      const validation = validateDomain(domain);

      if (!validation.valid || !validation.tld) {
        return {}; // Invalid domain - will fail in handler
      }

      const pricing = getTldPricing(validation.tld);
      if (!pricing) {
        return {};
      }

      return {
        [`POST ${c.req.path}`]: {
          accepts: {
            scheme: 'exact',
            payTo: env.X402_RECEIVING_ADDRESS,
            price: pricing.registrationPriceUsdc.toFixed(2),
            network: env.X402_NETWORK,
          }
        }
      };
    }),
    // Finally handle registration
    async (c) => {
      const { domain, targetUrl } = c.req.valid('json');

      // Extract payment data from context (exact key TBD - check @x402/hono source)
      // Likely: c.get('x402:settlement') or c.get('payment')
      const settlement = c.get('x402:settlement'); // VERIFY THIS
      const payerWallet = settlement.payer;
      const paymentId = settlement.transaction; // or use from payload

      // Create registration job
      const jobId = crypto.randomUUID();
      const job = {
        id: jobId,
        domainName: domain,
        ownerWallet: payerWallet,
        paymentId: paymentId,
        targetUrl: targetUrl,
        state: 'processing' as const,
        progress: 0,
        attempts: 0,
        createdAt: new Date(),
      };

      // Record payment and create job atomically
      db.transaction(() => {
        recordPayment(db, {
          paymentId,
          walletAddress: payerWallet,
          amount: pricing.registrationPriceUsdc.toString(),
          network: env.X402_NETWORK,
          domain,
        });

        db.insert(registrationJobs).values(job).run();
      });

      // Enqueue for background processing
      enqueueJob(jobId);

      // Return 202 Accepted with LRO response
      return c.json({
        jobId,
        statusUrl: `/registrations/${jobId}/status`,
        retryAfterSeconds: 2,
        message: 'Registration initiated - payment verified'
      }, 202);
    }
  );

  return router;
}
```

### LRO Status Endpoint
```typescript
// src/routes/registrations/status.ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { registrationJobs } from '../../db/schema';
import { createProblemResponse } from '../../lib/errors';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

export function createRegistrationStatusRoutes(db: BunSQLiteDatabase<any>) {
  const router = new Hono();

  router.get('/:jobId/status', (c) => {
    const jobId = c.req.param('jobId');

    const job = db
      .select()
      .from(registrationJobs)
      .where(eq(registrationJobs.id, jobId))
      .get();

    if (!job) {
      return createProblemResponse(
        c, 404, 'error:job_not_found',
        'Job Not Found', `Registration job ${jobId} not found`
      );
    }

    // Return LRO state based on job.state
    switch (job.state) {
      case 'processing':
        return c.json({
          state: 'processing',
          progress: job.progress,
        });

      case 'succeeded':
        return c.json({
          state: 'succeeded',
          artifactUrl: `/domains/${job.domainName}/status`,
          response: `Domain ${job.domainName} registered successfully`,
        });

      case 'failed':
        return c.json({
          state: 'failed',
          error: job.error || 'Registration failed',
          code: job.errorCode || 'unknown_error',
        });

      default:
        return createProblemResponse(
          c, 500, 'error:invalid_state',
          'Invalid Job State', `Job has invalid state: ${job.state}`
        );
    }
  });

  return router;
}
```

### Background Job Processor with Retry
```typescript
// src/lib/jobs/registration.ts
import { eq } from 'drizzle-orm';
import { registrationJobs, domains } from '../../db/schema';
import type { DomainRegistrar } from '../../integrations/registrar/types';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

export async function processRegistrationJob(
  jobId: string,
  registrar: DomainRegistrar,
  db: BunSQLiteDatabase<any>
) {
  const job = db
    .select()
    .from(registrationJobs)
    .where(eq(registrationJobs.id, jobId))
    .get();

  if (!job || job.state !== 'processing') {
    console.log(`Job ${jobId} not found or not in processing state`);
    return;
  }

  try {
    // Step 1: Update progress to 33% (payment verified)
    db.update(registrationJobs)
      .set({ progress: 33 })
      .where(eq(registrationJobs.id, jobId))
      .run();

    // Step 2: Call registrar API
    const contactInfo = getDefaultContactInfo(); // From env or config
    const result = await registrar.register(job.domainName, 1, contactInfo);

    if (!result.success) {
      throw new Error(`Registration failed: ${result.domain}`);
    }

    // Step 3: Update progress to 66% (registrar submitted)
    db.update(registrationJobs)
      .set({ progress: 66 })
      .where(eq(registrationJobs.id, jobId))
      .run();

    // Step 4: Create domain record
    const parsed = validateDomain(job.domainName);
    db.insert(domains).values({
      name: parsed.sld!,
      tld: parsed.tld!,
      status: 'registered',
      ownerWallet: job.ownerWallet,
      targetUrl: job.targetUrl || null,
      paymentId: job.paymentId,
      registrarOrderId: result.orderId,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).run();

    // Step 5: Mark job as succeeded
    db.update(registrationJobs)
      .set({
        state: 'succeeded',
        progress: 100,
        completedAt: new Date(),
      })
      .where(eq(registrationJobs.id, jobId))
      .run();

    console.log(`Job ${jobId} succeeded - domain ${job.domainName} registered`);

  } catch (error) {
    console.error(`Job ${jobId} attempt ${job.attempts + 1} failed:`, error);

    const nextAttempt = job.attempts + 1;

    if (nextAttempt >= MAX_ATTEMPTS) {
      // Max retries exhausted - mark as failed
      db.update(registrationJobs)
        .set({
          state: 'failed',
          error: error instanceof Error ? error.message : String(error),
          errorCode: 'max_retries_exceeded',
          completedAt: new Date(),
        })
        .where(eq(registrationJobs.id, jobId))
        .run();

      console.log(`Job ${jobId} failed permanently after ${MAX_ATTEMPTS} attempts`);
    } else {
      // Schedule retry with exponential backoff
      const delayMs = Math.pow(2, nextAttempt) * BASE_DELAY_MS;
      const nextRetryAt = new Date(Date.now() + delayMs);

      db.update(registrationJobs)
        .set({
          attempts: nextAttempt,
          nextRetryAt,
        })
        .where(eq(registrationJobs.id, jobId))
        .run();

      console.log(`Job ${jobId} will retry in ${delayMs}ms (attempt ${nextAttempt})`);

      // Schedule next retry
      setTimeout(() => {
        processRegistrationJob(jobId, registrar, db);
      }, delayMs);
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| x402 v1 exact payments only | x402 v2 with wallet-based identity, dynamic recipients | Jan 2026 | Supports multiple payment schemes, better agent integration |
| Synchronous registration | LRO pattern with 202 Accepted | Industry standard | Better UX for long-running operations, agent-friendly |
| BullMQ for job queues | In-memory + database queue | Current for MVP | Simpler for low volume, migrate to BullMQ when needed |
| Custom retry logic | Exponential backoff standard | Industry standard | Prevents thundering herd, predictable retry behavior |

**Deprecated/outdated:**
- x402 v1 PaymentRequirements structure: v2 uses different field names
- Single facilitator client: v2 supports multiple facilitator clients
- Static price in middleware: Now supports dynamic pricing via route config factory

## Open Questions

Things that couldn't be fully resolved:

1. **x402 Context Variable Access**
   - What we know: @x402/hono middleware sets verified payment data in Hono context
   - What's unclear: Exact context key name for accessing SettleResponse (payer, transaction, network)
   - Recommendation: Check @x402/hono source code or examples before implementation. Likely `c.get('x402:settlement')` or `c.get('payment')`.

2. **Contact Info for Agent Registrations**
   - What we know: Namecheap requires ContactInfo (name, address, phone, email) for all registrations
   - What's unclear: Can we use placeholder/service contact info for agent registrations? WHOIS privacy implications?
   - Recommendation: Review Namecheap API docs and terms. Consider storing default contact info in env vars. Flag as decision point in CONTEXT.md.

3. **Dynamic Pricing in Middleware**
   - What we know: PaymentRequirements price is set per route config
   - What's unclear: Best pattern for dynamic prices based on request body (domain TLD)
   - Recommendation: Use middleware factory that reads request body and returns route config. Verified pattern exists in codebase.

4. **Job Queue Persistence**
   - What we know: In-memory queue works for MVP
   - What's unclear: When to migrate to BullMQ? What volume triggers migration?
   - Recommendation: Start with in-memory. Monitor job volume and failure rate. Migrate to BullMQ if >100 jobs/day or persistence needed after crashes.

## Sources

### Primary (HIGH confidence)
- Existing codebase (apps/api/src/*) - All patterns verified from actual implementation
- @x402/hono type definitions (node_modules/@x402/hono/dist/cjs/index.d.ts) - Official types
- @x402/core type definitions (mechanisms-CzuGzYsS.d.ts) - Payment payload structure
- Database schema (apps/api/src/db/schema.ts) - Existing tables and patterns
- Drizzle migrations (apps/api/drizzle/*.sql) - Database structure

### Secondary (MEDIUM confidence)
- [x402.jobs LRO pattern](https://www.x402.jobs/docs/long-running-resources) - LRO spec via WebFetch
- [BullMQ retry documentation](https://docs.bullmq.io/guide/retrying-failing-jobs) - Exponential backoff patterns
- [Hono context API](https://hono.dev/docs/api/context) - Context variable access patterns

### Tertiary (LOW confidence)
- x402 payment protocol general documentation - High-level overview, not implementation specifics
- Azure Core LRO package - Reference implementation, not directly applicable
- Generic Node.js job queue patterns - Background on async processing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages already in use, versions verified from package.json
- Architecture: HIGH - Patterns extracted from existing Phase 2/3 code, factory routes, Drizzle patterns
- Pitfalls: MEDIUM - Some based on general async/payment patterns, contactInfo gap needs verification
- x402 context access: LOW - Exact context variable key name not found in docs, needs source verification

**Research date:** 2026-02-04
**Valid until:** 2026-03-04 (30 days - stable dependencies, x402 protocol is standardized)

**Critical verification needed before planning:**
1. Exact context key for accessing x402 SettleResponse after middleware
2. ContactInfo requirements for agent registrations (Namecheap policy)
3. Confirm payment ID is accessible from settlement response
