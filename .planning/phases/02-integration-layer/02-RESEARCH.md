# Phase 2: Integration Layer - Research

**Researched:** 2026-02-03
**Domain:** External API integrations (domain registrar, payment verification)
**Confidence:** MEDIUM

## Summary

This phase integrates two external systems: Namecheap domain registration API and x402 payment verification. The standard approach uses the adapter pattern with TypeScript interfaces for registrars (enabling future multi-provider support) and the official @x402/hono middleware for payment handling. Key architectural decisions include using abstract classes (not interfaces) for runtime dependency injection, implementing replay protection via SQLite unique constraints, and separating test mocks from production code.

The research reveals that while the x402 ecosystem is mature with official SDKs and testnet facilitators, the @openfacilitator/sdk package mentioned in requirements does not exist in npm. The correct package is @x402/hono with @x402/core. Namecheap's API requires careful handling of sandbox vs production environments, with separate accounts and known limitations (e.g., .co.uk domains don't work in sandbox).

**Primary recommendation:** Use abstract classes (not interfaces) for registrar abstraction to enable dependency injection, implement the adapter pattern for Namecheap integration, use @x402/hono middleware directly (not @openfacilitator/sdk), and enforce replay protection with SQLite unique indexes on payment IDs.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @x402/hono | Latest | x402 payment middleware for Hono | Official Coinbase x402 SDK for Hono framework integration |
| @x402/core | Latest | x402 core types and facilitator client | Required for HTTPFacilitatorClient and payment verification |
| @x402/evm | Latest | EVM payment scheme support | Required for Base network (EVM-compatible) payment verification |
| better-sqlite3 | Latest | Synchronous SQLite driver | Drizzle ORM's recommended SQLite driver, simpler than async drivers |
| drizzle-orm | Latest | TypeScript ORM | Type-safe database queries with excellent SQLite support |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @x402/solana | Latest | Solana payment scheme support | Required if supporting Solana network payments (requirements specify Base + Solana) |
| drizzle-kit | Latest | Schema migrations | Development tool for generating migrations and pushing schema changes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Abstract class | TypeScript interface | Interfaces don't exist at runtime, can't be used as DI tokens |
| @x402/hono | Custom x402 implementation | Custom implementations miss protocol updates, violate "don't hand-roll" principle |
| better-sqlite3 | libsql | libsql adds network capabilities not needed for local SQLite |

**Installation:**
```bash
npm install @x402/hono @x402/core @x402/evm @x402/solana
npm install drizzle-orm better-sqlite3
npm install -D drizzle-kit @types/better-sqlite3
```

**IMPORTANT NOTE:** The requirements mention `@openfacilitator/sdk` but this package does not exist in npm as of 2026-02-03. The correct packages are `@x402/hono`, `@x402/core`, and `@x402/evm` from the official Coinbase x402 SDK.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── integrations/
│   ├── registrar/
│   │   ├── types.ts              # Abstract class + error types
│   │   ├── namecheap.ts          # Namecheap implementation
│   │   └── mock.ts               # Mock registrar for tests
│   └── payment/
│       ├── middleware.ts         # x402 middleware configuration
│       └── replay-protection.ts  # Payment ID storage + verification
├── db/
│   ├── schema.ts                 # Drizzle schema definitions
│   └── index.ts                  # Database client
└── config/
    └── env.ts                    # Environment configuration
```

### Pattern 1: Abstract Class for Registrar Interface

**What:** Use abstract class (not interface) to define registrar contract
**When to use:** When you need runtime dependency injection tokens in TypeScript

**Example:**
```typescript
// Source: TypeScript best practices + DI patterns
// https://dev.to/ef/nestjs-dependency-injection-with-abstract-classes-4g65

// src/integrations/registrar/types.ts
export abstract class DomainRegistrar {
  abstract checkAvailability(domain: string): Promise<DomainAvailability>;
  abstract getPrice(domain: string): Promise<DomainPrice>;
  abstract register(domain: string, years: number, contactInfo: ContactInfo): Promise<RegistrationResult>;
  abstract getStatus(domain: string): Promise<DomainStatus>;
  abstract setDnsRecords(domain: string, records: DnsRecord[]): Promise<void>;
  abstract getDnsRecords(domain: string): Promise<DnsRecord[]>;
}

// Typed error classes - extend Error with proper prototype chain
export class RegistrarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrarError';
    Object.setPrototypeOf(this, RegistrarError.prototype);
  }
}

export class RegistrarUnavailable extends RegistrarError {
  constructor() {
    super('Registrar API unavailable');
    this.name = 'RegistrarUnavailable';
    Object.setPrototypeOf(this, RegistrarUnavailable.prototype);
  }
}

export class DomainTaken extends RegistrarError {
  constructor(domain: string) {
    super(`Domain ${domain} is already taken`);
    this.name = 'DomainTaken';
    Object.setPrototypeOf(this, DomainTaken.prototype);
  }
}

export class InvalidTLD extends RegistrarError {
  constructor(tld: string) {
    super(`TLD ${tld} is not supported`);
    this.name = 'InvalidTLD';
    Object.setPrototypeOf(this, InvalidTLD.prototype);
  }
}
```

**Why abstract class over interface:**
- TypeScript interfaces disappear at runtime, can't be used as DI tokens
- Abstract classes exist at runtime, can be used for dependency injection
- Allows instanceof checks for error handling
- Enables Template Method pattern if needed

### Pattern 2: Adapter Pattern for Namecheap

**What:** Implement abstract registrar class to adapt Namecheap API
**When to use:** Integrating third-party APIs with incompatible interfaces

**Example:**
```typescript
// Source: Adapter pattern best practices
// https://refactoring.guru/design-patterns/adapter/typescript/example

// src/integrations/registrar/namecheap.ts
import { DomainRegistrar, DomainAvailability } from './types';

export class NamecheapRegistrar extends DomainRegistrar {
  constructor(
    private apiUser: string,
    private apiKey: string,
    private clientIp: string,
    private sandbox: boolean = false
  ) {
    super();
  }

  private get apiUrl(): string {
    return this.sandbox
      ? 'https://api.sandbox.namecheap.com/xml.response'
      : 'https://api.namecheap.com/xml.response';
  }

  async checkAvailability(domain: string): Promise<DomainAvailability> {
    const response = await this.callApi('namecheap.domains.check', {
      DomainList: domain
    });

    // Transform Namecheap XML response to internal format
    return this.parseAvailabilityResponse(response);
  }

  private async callApi(command: string, params: Record<string, string>) {
    const url = new URL(this.apiUrl);
    url.searchParams.set('ApiUser', this.apiUser);
    url.searchParams.set('ApiKey', this.apiKey);
    url.searchParams.set('UserName', this.apiUser);
    url.searchParams.set('ClientIp', this.clientIp);
    url.searchParams.set('Command', command);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString());
    // Parse XML, check for errors, etc.
    return response;
  }
}
```

### Pattern 3: x402 Payment Middleware Integration

**What:** Use official @x402/hono middleware for payment verification
**When to use:** Always - don't hand-roll x402 protocol handling

**Example:**
```typescript
// Source: Official Coinbase x402 Hono example
// https://github.com/coinbase/x402/tree/main/examples/typescript/servers/hono

// src/integrations/payment/middleware.ts
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

export function createPaymentMiddleware(
  receivingAddress: string,
  facilitatorUrl: string = "https://x402.org/facilitator"
) {
  const resourceServer = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: facilitatorUrl })
  )
    .register("eip155:84532", new ExactEvmScheme()) // Base Sepolia
    .register("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", new SolanaScheme()); // Solana Devnet

  return paymentMiddleware(
    {
      "POST /register": {
        accepts: {
          scheme: "exact",
          price: "$10.00", // Example price
          network: "eip155:84532", // Base Sepolia for testing
          payTo: receivingAddress,
        },
        description: "Domain registration",
        mimeType: "application/json",
      },
    },
    resourceServer
  );
}
```

**Network identifiers (CAIP-2 format):**
- Base Sepolia (testnet): `eip155:84532`
- Base Mainnet: `eip155:8453`
- Solana Devnet: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`
- Solana Mainnet: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`

### Pattern 4: Replay Protection with SQLite Unique Index

**What:** Store payment IDs in SQLite with unique constraint
**When to use:** Always - prevents duplicate payment acceptance

**Example:**
```typescript
// Source: Drizzle ORM unique constraint documentation
// https://orm.drizzle.team/docs/indexes-constraints

// src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const paymentRecords = sqliteTable('payment_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paymentId: text('payment_id').notNull().unique(), // Unique constraint prevents duplicates
  walletAddress: text('wallet_address').notNull(),
  amount: text('amount').notNull(), // Store as string to avoid precision issues
  network: text('network').notNull(),
  domain: text('domain'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// src/integrations/payment/replay-protection.ts
import { db } from '../../db';
import { paymentRecords } from '../../db/schema';
import { eq } from 'drizzle-orm';

export async function recordPayment(
  paymentId: string,
  walletAddress: string,
  amount: string,
  network: string,
  domain?: string
): Promise<void> {
  try {
    await db.insert(paymentRecords).values({
      paymentId,
      walletAddress,
      amount,
      network,
      domain,
      createdAt: new Date(),
    });
  } catch (error) {
    // SQLite unique constraint violation
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      throw new DuplicatePaymentError(paymentId);
    }
    throw error;
  }
}

export class DuplicatePaymentError extends Error {
  constructor(paymentId: string) {
    super(`Payment ID ${paymentId} has already been used`);
    this.name = 'DuplicatePaymentError';
  }
}
```

### Pattern 5: Mock Registrar for Testing

**What:** Simple stub implementation that returns hardcoded success responses
**When to use:** Tests only - never in production code

**Example:**
```typescript
// src/integrations/registrar/mock.ts
import { DomainRegistrar, DomainAvailability, DomainPrice } from './types';

export class MockRegistrar extends DomainRegistrar {
  async checkAvailability(domain: string): Promise<DomainAvailability> {
    return {
      domain,
      available: true,
      isPremium: false,
    };
  }

  async getPrice(domain: string): Promise<DomainPrice> {
    // Return realistic Namecheap-like pricing
    const tld = domain.split('.').pop();
    const prices: Record<string, number> = {
      'com': 10.98,
      'net': 13.98,
      'org': 14.98,
      'io': 39.98,
    };

    return {
      domain,
      registrationPrice: prices[tld || 'com'] || 10.98,
      renewalPrice: prices[tld || 'com'] || 10.98,
      currency: 'USD',
    };
  }

  async register(): Promise<RegistrationResult> {
    return {
      success: true,
      domain: 'example.com',
      transactionId: 'MOCK-' + Date.now(),
    };
  }

  // ... other methods return success with hardcoded data
}
```

### Anti-Patterns to Avoid

- **Using TypeScript interfaces for DI**: Interfaces don't exist at runtime, causing DI failures
- **Custom x402 implementation**: Protocol is complex, SDK handles edge cases
- **Forgetting prototype chain in errors**: `instanceof` checks fail without `Object.setPrototypeOf`
- **Async better-sqlite3 usage**: better-sqlite3 is synchronous, don't await its methods
- **Missing unique constraint**: Replay attacks succeed if payment IDs aren't unique
- **Sandbox data in production**: Separate Namecheap accounts required, different API URLs

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| x402 payment protocol | Custom HTTP 402 handler | @x402/hono + @x402/core | Protocol has complex edge cases: signature verification, facilitator communication, network-specific payment schemes, CAIP-2 identifiers |
| Namecheap XML API client | Raw XML parsing + HTTP | Adapter pattern over HTTP client | API has quirks: XML response format, error codes, rate limiting, sandbox vs production differences |
| Payment ID uniqueness | In-memory Set | SQLite unique constraint | In-memory lost on restart, SQLite provides persistence + atomicity |
| Custom error types | String error codes | Typed Error classes | TypeScript can't narrow types on string codes, instanceof works with classes |
| Domain price currency conversion | Manual USD to USDC conversion | 1:1 peg assumption | USDC maintains 1:1 peg with USD, conversion adds unnecessary complexity |

**Key insight:** Integration code has hidden complexity in error handling, network reliability, and protocol compliance. Use official SDKs and battle-tested patterns rather than building from scratch.

## Common Pitfalls

### Pitfall 1: Interface vs Abstract Class Confusion
**What goes wrong:** Using TypeScript interface for registrar contract, then dependency injection fails at runtime
**Why it happens:** Interfaces are compile-time only - they disappear in compiled JavaScript
**How to avoid:** Use abstract classes for any type that needs runtime existence (DI tokens, instanceof checks)
**Warning signs:**
- DI container throws "Cannot inject undefined"
- instanceof checks always return false
- Runtime type checking fails

### Pitfall 2: Namecheap Sandbox Limitations Not Documented
**What goes wrong:** Code works in development (sandbox) but fails in production, or vice versa
**Why it happens:** Sandbox has known limitations: .co.uk domains don't work, premium domain prices are wrong, domain availability doesn't change after registration
**How to avoid:**
- Document known sandbox limitations in code comments
- Test with multiple TLDs, not just .com
- Verify premium domain handling separately
**Warning signs:**
- Tests pass but production fails with specific TLDs
- Premium domain prices are $0
- Registration succeeds but availability check still shows "available"

### Pitfall 3: Missing IP Whitelisting
**What goes wrong:** Namecheap API returns authentication errors despite valid credentials
**Why it happens:** Namecheap requires IPv4 address whitelisting before API access works
**How to avoid:**
- Whitelist development and production IPs in Namecheap dashboard
- Document IP whitelisting requirement in setup docs
- Handle authentication errors gracefully with helpful messages
**Warning signs:**
- Valid credentials but consistent authentication failures
- Error message mentions "IP not whitelisted" or similar

### Pitfall 4: Rate Limit Exhaustion
**What goes wrong:** API calls start failing with "Too many requests" errors
**Why it happens:** Namecheap limits: 20/min, 700/hour, 8000/day per API key
**How to avoid:**
- Implement rate limiting in application code
- Cache domain availability checks
- Use exponential backoff on errors
- Monitor rate limit consumption
**Warning signs:**
- Error code [500000]
- Intermittent failures during high-traffic periods
- All API calls fail simultaneously

### Pitfall 5: Forgetting Custom Error Prototype Chain
**What goes wrong:** `instanceof RegistrarError` returns false even for registrar errors
**Why it happens:** TypeScript's default Error extension doesn't set prototype chain correctly
**How to avoid:** Always call `Object.setPrototypeOf(this, ConstructorName.prototype)` in error constructors
**Warning signs:**
- instanceof checks fail
- Error type narrowing doesn't work
- catch blocks can't discriminate error types

### Pitfall 6: Async/Await with better-sqlite3
**What goes wrong:** Code hangs or behaves unexpectedly with better-sqlite3
**Why it happens:** better-sqlite3 is synchronous, not promise-based
**How to avoid:** Don't await better-sqlite3 methods, Drizzle handles the sync/async boundary
**Warning signs:**
- Database operations hang indefinitely
- Type errors about missing Promise methods

### Pitfall 7: Replay Protection Race Conditions
**What goes wrong:** Same payment ID accepted twice in rapid succession
**Why it happens:** Check-then-insert pattern has race window
**How to avoid:** Rely on SQLite unique constraint for atomicity, catch constraint errors
**Warning signs:**
- Duplicate payments appear in audit log
- Race condition reproducible with concurrent requests

### Pitfall 8: x402 Network Identifier Mistakes
**What goes wrong:** Payment verification fails with valid payments
**Why it happens:** Using wrong CAIP-2 network identifier format or wrong network ID
**How to avoid:** Use exact identifiers from official docs, verify testnet vs mainnet
**Warning signs:**
- Payment signature valid but verification fails
- "Unsupported network" errors
- Testnet transactions rejected as invalid

### Pitfall 9: Not Handling Namecheap XML Errors
**What goes wrong:** API errors not caught, application crashes
**Why it happens:** Namecheap returns errors in XML format with specific structure
**How to avoid:** Parse XML response, check for `<Errors>` element, extract error codes
**Warning signs:**
- Uncaught exceptions from Namecheap API calls
- Generic HTTP errors without specific cause

### Pitfall 10: Premium Domain Price Handling
**What goes wrong:** Premium domain registration fails or charges wrong amount
**Why it happens:** Namecheap requires explicit premium flag and exact price
**How to avoid:**
- Check domain availability first (returns premium status + price)
- Pass premium flag and price to registration call
- Don't rely on `users.getPricing` for premium domains (returns $0)
**Warning signs:**
- Premium domain registration rejected
- Price mismatch errors
- `users.getPricing` returns 0 for known premium domains

## Code Examples

Verified patterns from official sources:

### Drizzle ORM Setup with better-sqlite3
```typescript
// Source: Official Drizzle documentation
// https://orm.drizzle.team/docs/get-started-sqlite

import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

const sqlite = new Database('sqlite.db');
const db = drizzle({ client: sqlite });

export { db };
```

### Drizzle Schema with Unique Constraint
```typescript
// Source: Drizzle indexes & constraints documentation
// https://orm.drizzle.team/docs/indexes-constraints

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const paymentRecords = sqliteTable('payment_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paymentId: text('payment_id').notNull().unique(),
  walletAddress: text('wallet_address').notNull(),
  amount: text('amount').notNull(),
  network: text('network').notNull(),
  domain: text('domain'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
```

### HTTP 409 Conflict for Duplicate Payment
```typescript
// Source: HTTP 409 Conflict idempotency pattern
// https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/409

import { Context } from 'hono';
import { DuplicatePaymentError } from './integrations/payment/replay-protection';

app.post('/register', async (c: Context) => {
  try {
    // ... payment handling
  } catch (error) {
    if (error instanceof DuplicatePaymentError) {
      return c.json(
        { error: 'Payment ID has already been used' },
        409
      );
    }
    throw error;
  }
});
```

### Namecheap API Call Structure
```typescript
// Source: Namecheap API documentation + community implementations
// https://www.namecheap.com/support/api/methods/domains/check/

async function checkDomain(domain: string): Promise<DomainAvailability> {
  const url = new URL(this.apiUrl);
  const params = {
    ApiUser: this.apiUser,
    ApiKey: this.apiKey,
    UserName: this.apiUser,
    ClientIp: this.clientIp,
    Command: 'namecheap.domains.check',
    DomainList: domain,
  };

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());
  const xmlText = await response.text();

  // Parse XML response
  // Check for <Errors> element
  // Extract domain availability from <DomainCheckResult>

  return parseAvailabilityResponse(xmlText);
}
```

### Hono Context Extension for DI
```typescript
// Source: Hono middleware type safety patterns
// https://hono.dev/docs/guides/middleware

import { Hono } from 'hono';
import { DomainRegistrar } from './integrations/registrar/types';

type Env = {
  Variables: {
    registrar: DomainRegistrar;
  };
};

const app = new Hono<Env>();

// Middleware to inject registrar
app.use('*', (c, next) => {
  const registrar = createRegistrar(); // Factory function
  c.set('registrar', registrar);
  return next();
});

// Route handler with typed access
app.post('/register', async (c) => {
  const registrar = c.get('registrar');
  const result = await registrar.checkAvailability('example.com');
  return c.json(result);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| x402-hono (separate) | @x402/hono | Jan 2026 | x402 v2 update consolidated packages, CAIP-2 identifiers |
| Single facilitator | Multi-facilitator support | Jan 2026 | Can use multiple facilitators for redundancy |
| Single-request payments only | Payment channels + streaming | Jan 2026 | Enables subscription and micropayment models |
| Interface-based DI | Abstract class DI | Established pattern | TypeScript limitation, not new but commonly misunderstood |
| In-memory replay protection | Persistent storage | Always required | Production systems need persistence |

**Deprecated/outdated:**
- **x402-hono** (standalone package): Replaced by @x402/hono from official Coinbase SDK
- **@openfacilitator/sdk**: This package doesn't exist; documentation may be outdated or incorrect
- **Simple network strings**: Use CAIP-2 format identifiers instead (e.g., "eip155:84532" not "base-sepolia")

## Open Questions

Things that couldn't be fully resolved:

1. **@openfacilitator/sdk package existence**
   - What we know: Requirements mention this package, but npm search returns no results
   - What's unclear: Whether package is private, not yet published, or documentation error
   - Recommendation: Use @x402/hono and @x402/core from official Coinbase SDK instead

2. **Optimal Namecheap rate limit handling**
   - What we know: Limits are 20/min, 700/hour, 8000/day
   - What's unclear: Best practices for distributed systems, whether to implement client-side queuing
   - Recommendation: Start with simple in-memory rate limiting, monitor for issues

3. **Mock registrar error simulation**
   - What we know: User specified "Claude's discretion" on whether to add configurable error triggers
   - What's unclear: Whether tests need to verify error handling paths for registrar failures
   - Recommendation: Start with always-succeed mock, add error triggers if tests require it

4. **Markup percentage configuration**
   - What we know: User wants configurable percentage markup (e.g., 20%)
   - What's unclear: Whether markup applies per-domain, per-TLD, or globally
   - Recommendation: Start with global configurable percentage via environment variable

5. **SQLite transaction isolation for replay protection**
   - What we know: Unique constraint prevents duplicates, but transaction isolation level matters
   - What's unclear: Whether better-sqlite3 default isolation is sufficient or needs explicit setting
   - Recommendation: Rely on SQLite default (SERIALIZABLE), monitor for race conditions

## Sources

### Primary (HIGH confidence)
- [Coinbase x402 GitHub - Hono Example](https://github.com/coinbase/x402/tree/main/examples/typescript/servers/hono) - Official x402 Hono integration
- [Coinbase x402 Quickstart](https://docs.cdp.coinbase.com/x402/quickstart-for-sellers) - Official seller documentation
- [Drizzle ORM SQLite Getting Started](https://orm.drizzle.team/docs/get-started-sqlite) - Official Drizzle documentation
- [Drizzle ORM Indexes & Constraints](https://orm.drizzle.team/docs/indexes-constraints) - Official constraint documentation
- [Namecheap API Documentation](https://www.namecheap.com/support/api/methods/) - Official API reference
- [Namecheap API Error Codes](https://www.namecheap.com/support/api/error-codes/) - Official error reference

### Secondary (MEDIUM confidence)
- [Adapter Pattern in TypeScript](https://refactoring.guru/design-patterns/adapter/typescript/example) - Verified design pattern resource
- [TypeScript Abstract Class vs Interface](https://khalilstemmler.com/blogs/typescript/abstract-class/) - Community best practices (2024-2026)
- [Hono Middleware Documentation](https://hono.dev/docs/guides/middleware) - Official Hono framework docs
- [HTTP 409 Conflict MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/409) - Official HTTP specification
- [NestJS Dependency Injection with Abstract Classes](https://dev.to/ef/nestjs-dependency-injection-with-abstract-classes-4g65) - Community pattern (2021, still relevant)

### Secondary (MEDIUM confidence) - x402 Ecosystem
- [x402.org Ecosystem](https://www.x402.org/ecosystem) - Official x402 protocol site
- [Solana x402 Guide](https://solana.com/developers/guides/getstarted/intro-to-x402) - Official Solana integration
- [x402 Network Support](https://docs.cdp.coinbase.com/x402/network-support) - Official network identifiers
- [InfoQ: x402 Major Upgrade](https://www.infoq.com/news/2026/01/x402-agentic-http-payments/) - News article (Jan 2026)

### Tertiary (LOW confidence) - Namecheap Community
- [Cofense: Namecheap API Challenges](https://cofense.com/blog/domain-challenges-with-namecheaps-api/) - Community experience
- [Namecheap Sandbox Issues](https://www.namecheap.com/support/knowledgebase/article.aspx/9262/2196/2-sandbox-and-production-environments/) - Official sandbox documentation

### Tertiary (LOW confidence) - Not Verified
- [OpenFacilitator.io](https://www.openfacilitator.io/) - Site exists but package not found in npm
- Various WebSearch results on TypeScript patterns - General guidance, not specific to this use case

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM - @x402 packages verified from official sources, @openfacilitator/sdk doesn't exist
- Architecture patterns: HIGH - Adapter pattern, abstract class DI, x402 middleware are established and documented
- Namecheap integration: MEDIUM - Official API docs available but community reports edge cases
- Pitfalls: HIGH - Rate limits, sandbox issues, and x402 network identifiers verified from official sources
- Replay protection: HIGH - SQLite unique constraints and HTTP 409 are standard patterns

**Research date:** 2026-02-03
**Valid until:** 2026-03-05 (30 days - stable technologies, but x402 ecosystem evolving rapidly)

**Critical findings:**
1. ⚠️ **@openfacilitator/sdk does not exist** - Use @x402/hono instead
2. ⚠️ **Abstract classes required for DI** - Interfaces won't work at runtime
3. ⚠️ **Namecheap sandbox has limitations** - .co.uk domains, premium pricing
4. ⚠️ **CAIP-2 network identifiers required** - Not simple strings like "base-sepolia"
5. ✅ **x402 testnet facilitator available** - https://x402.org/facilitator for testing
