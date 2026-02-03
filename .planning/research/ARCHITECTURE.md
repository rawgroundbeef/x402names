# Architecture Research: x402names

**Project:** x402names Domain Registration Service
**Researched:** 2026-02-03
**Confidence:** MEDIUM (based on framework training knowledge, official docs inaccessible)

## System Overview

x402names is a payment-gated domain registration API. The architecture centers on three core flows:

1. **Payment verification** (x402 protocol via @openfacilitator/sdk)
2. **Domain registration** (abstract registrar interface, Namecheap implementation)
3. **DNS/URL mapping** (domain → target URL configuration)

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT (Agent)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   HONO HTTP API SERVER                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Middleware Chain:                                     │  │
│  │  1. Error Handler                                      │  │
│  │  2. Request Logger                                     │  │
│  │  3. CORS (if needed)                                   │  │
│  │  4. x402 Payment Verification (@openfacilitator/sdk)   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Route Handlers:                                       │  │
│  │  • GET  /domains/:name/availability                    │  │
│  │  • POST /domains/:name/register (x402-protected)       │  │
│  │  • GET  /domains/:name/status                          │  │
│  │  • PUT  /domains/:name/target (x402-protected)         │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
    ┌──────────────┐  ┌─────────────┐  ┌──────────────┐
    │   Database   │  │  Registrar  │  │   Payment    │
    │   Service    │  │  Interface  │  │   Verifier   │
    └──────────────┘  └─────────────┘  └──────────────┘
            │               │
            ▼               ▼
    ┌──────────────┐  ┌─────────────┐
    │    SQLite    │  │  Namecheap  │
    │   Database   │  │     API     │
    └──────────────┘  └─────────────┘
```

### Core Components

| Component | Responsibility | Tech |
|-----------|---------------|------|
| **HTTP Server** | Request routing, middleware orchestration | Hono |
| **x402 Middleware** | Payment verification, wallet authentication | @openfacilitator/sdk |
| **Route Handlers** | Business logic orchestration | TypeScript |
| **Registrar Interface** | Abstract domain registration API | TypeScript interface |
| **Namecheap Adapter** | Concrete registrar implementation | Namecheap API client |
| **Database Service** | Domain ownership, transaction records | better-sqlite3 |
| **Config Manager** | Environment-aware configuration | Custom config loader |

---

## Hono Application Structure

**Confidence:** MEDIUM (based on Hono training knowledge as of Jan 2025)

### Recommended Project Layout

```
src/
├── index.ts                 # Entry point, server initialization
├── app.ts                   # Hono app creation, middleware setup
├── config/
│   └── index.ts            # Environment configuration loader
├── middleware/
│   ├── error-handler.ts    # Global error handling
│   ├── logger.ts           # Request/response logging
│   └── x402-auth.ts        # x402 payment verification wrapper
├── routes/
│   ├── index.ts            # Route aggregation
│   ├── domains.ts          # Domain-related routes
│   └── health.ts           # Health check endpoint
├── services/
│   ├── registrar/
│   │   ├── interface.ts    # Abstract registrar interface
│   │   ├── namecheap.ts    # Namecheap implementation
│   │   └── factory.ts      # Registrar factory pattern
│   ├── database/
│   │   ├── client.ts       # SQLite client wrapper
│   │   ├── migrations.ts   # Migration runner
│   │   └── queries.ts      # Prepared SQL queries
│   ├── payment.ts          # x402 payment logic
│   └── dns.ts              # DNS configuration logic
├── types/
│   ├── api.ts              # API request/response types
│   └── domain.ts           # Domain entity types
└── utils/
    ├── errors.ts           # Custom error classes
    └── validation.ts       # Input validation helpers
```

### Hono Middleware Pattern

Hono middleware follows a chain-of-responsibility pattern. Each middleware can:
- Transform the request
- Short-circuit with a response
- Pass to next middleware via `await next()`

**Example structure:**

```typescript
// app.ts
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { errorHandler } from './middleware/error-handler'
import { x402Auth } from './middleware/x402-auth'
import domainRoutes from './routes/domains'

const app = new Hono()

// Global middleware (order matters!)
app.use('*', errorHandler)        // Catch all errors
app.use('*', logger())             // Log all requests
app.use('*', cors())               // CORS if needed

// Mount routes
app.route('/domains', domainRoutes)

// Health check (no auth needed)
app.get('/health', (c) => c.json({ status: 'ok' }))

export default app
```

**Route-specific middleware:**

```typescript
// routes/domains.ts
import { Hono } from 'hono'
import { x402Auth } from '../middleware/x402-auth'

const domains = new Hono()

// Public endpoint (no payment required)
domains.get('/:name/availability', async (c) => {
  const name = c.req.param('name')
  // Check availability logic
})

// Protected endpoint (requires x402 payment)
domains.post('/:name/register', x402Auth({ amount: '10.00' }), async (c) => {
  // Payment verified by middleware
  // Access wallet address: c.get('walletAddress')
  const name = c.req.param('name')
  const { targetUrl } = await c.req.json()
  // Registration logic
})

export default domains
```

### Error Handling Pattern

Hono supports both try-catch and error middleware patterns.

**Recommended approach:**

```typescript
// middleware/error-handler.ts
import { Context, Next } from 'hono'

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message)
  }
}

export const errorHandler = async (c: Context, next: Next) => {
  try {
    await next()
  } catch (err) {
    if (err instanceof AppError) {
      return c.json({
        error: err.message,
        code: err.code
      }, err.statusCode)
    }

    // Unknown errors
    console.error('Unhandled error:', err)
    return c.json({
      error: 'Internal server error'
    }, 500)
  }
}
```

---

## x402 Payment Integration

**Confidence:** LOW (SDK docs inaccessible, inferring from x402 protocol patterns)

### How x402 Protocol Works

x402 is an HTTP 402 (Payment Required) based micropayment protocol. The flow:

1. **Client makes request** without payment proof
2. **Server responds 402** with payment instructions (amount, recipient, chain)
3. **Client signs USDC transaction** and includes proof in retry
4. **Server verifies payment** on-chain and processes request

### @openfacilitator/sdk Integration Pattern

**Inferred usage (needs verification with official docs):**

```typescript
// middleware/x402-auth.ts
import { x402Middleware } from '@openfacilitator/sdk'

export const x402Auth = (options: {
  amount: string  // USDC amount required
  recipient?: string  // Payment recipient (defaults to config)
}) => {
  return x402Middleware({
    amount: options.amount,
    recipient: options.recipient || process.env.PAYMENT_WALLET,
    chain: 'base',  // Base for USDC
    verifyPayment: async (proof) => {
      // SDK handles on-chain verification
      // Returns wallet address if valid
    },
    onPaymentReceived: async (walletAddress, txHash) => {
      // Log payment for accounting
      await db.recordPayment({
        walletAddress,
        txHash,
        amount: options.amount,
        timestamp: Date.now()
      })
    }
  })
}
```

**Usage in route:**

```typescript
// Protected route
domains.post('/:name/register',
  x402Auth({ amount: '10.00' }),
  async (c) => {
    // Payment already verified by middleware
    const walletAddress = c.get('walletAddress')  // Set by middleware
    const txHash = c.get('txHash')  // Payment transaction

    // Proceed with registration
  }
)
```

### Payment Verification Flow

```
Client Request (no payment)
  │
  ▼
[x402 Middleware]
  │
  ├─► No payment proof? → Return 402 with payment details
  │
  ├─► Payment proof included?
  │     │
  │     ▼
  │   [Verify on-chain]
  │     │
  │     ├─► Invalid? → Return 403 Forbidden
  │     │
  │     └─► Valid? → Set c.context.walletAddress, continue
  │
  ▼
[Route Handler] (payment verified)
```

**RESEARCH FLAG:** Official @openfacilitator/sdk documentation needed to verify:
- Exact middleware API signature
- Payment proof format
- Retry mechanism (does client auto-retry with payment?)
- Context variable names (walletAddress, txHash, etc.)

---

## Registrar Abstraction Pattern

**Confidence:** HIGH (standard interface design patterns)

### Interface Design

The registrar interface abstracts domain registration provider APIs. This enables:
- Swapping providers without changing business logic
- Testing with mock registrar
- Multi-provider support (future)

**Core interface:**

```typescript
// services/registrar/interface.ts

export interface DomainAvailability {
  available: boolean
  price: {
    amount: string  // Decimal string (e.g., "10.00")
    currency: 'USD'
  }
  premium?: boolean
}

export interface DomainRegistration {
  domain: string
  status: 'pending' | 'active' | 'failed'
  registeredAt?: Date
  expiresAt?: Date
  nameservers: string[]
}

export interface DNSRecord {
  type: 'A' | 'AAAA' | 'CNAME' | 'URL' | 'URL301'
  host: string
  value: string
  ttl?: number
}

export interface IRegistrar {
  /**
   * Check if domain is available and get pricing
   */
  checkAvailability(domain: string): Promise<DomainAvailability>

  /**
   * Register domain with customer details
   */
  registerDomain(
    domain: string,
    options: {
      years: number
      contacts: ContactInfo
      nameservers?: string[]
    }
  ): Promise<DomainRegistration>

  /**
   * Get domain registration details
   */
  getDomainInfo(domain: string): Promise<DomainRegistration>

  /**
   * Update DNS records for domain
   */
  setDNSRecords(
    domain: string,
    records: DNSRecord[]
  ): Promise<void>

  /**
   * Set URL forwarding for domain
   */
  setURLForwarding(
    domain: string,
    targetUrl: string,
    options?: {
      redirect: boolean  // 301 vs masked forwarding
      includeSubdomain: boolean  // www.domain.com → target
    }
  ): Promise<void>
}
```

### Namecheap Implementation

**Confidence:** MEDIUM (based on typical domain registrar API patterns)

Namecheap uses XML API with shared secret authentication.

```typescript
// services/registrar/namecheap.ts

export class NamecheapRegistrar implements IRegistrar {
  private apiKey: string
  private apiUser: string
  private apiUrl: string
  private clientIp: string

  constructor(config: NamecheapConfig) {
    this.apiKey = config.apiKey
    this.apiUser = config.apiUser
    this.apiUrl = config.sandbox
      ? 'https://api.sandbox.namecheap.com/xml.response'
      : 'https://api.namecheap.com/xml.response'
    this.clientIp = config.clientIp  // Whitelisted IP
  }

  async checkAvailability(domain: string): Promise<DomainAvailability> {
    const [sld, tld] = this.parseDomain(domain)

    const response = await this.apiCall('namecheap.domains.check', {
      DomainList: domain
    })

    const result = response.DomainCheckResult[0]
    const price = await this.getPrice(domain)

    return {
      available: result.Available === 'true',
      price: {
        amount: price,
        currency: 'USD'
      }
    }
  }

  async registerDomain(
    domain: string,
    options: RegisterOptions
  ): Promise<DomainRegistration> {
    const [sld, tld] = this.parseDomain(domain)

    const response = await this.apiCall('namecheap.domains.create', {
      DomainName: domain,
      Years: options.years,
      // Contact info (Namecheap requires registrant/admin/tech/billing)
      ...this.formatContacts(options.contacts),
      // Use our nameservers by default
      Nameservers: options.nameservers?.join(',') || this.defaultNameservers.join(',')
    })

    return {
      domain,
      status: response.Registered ? 'active' : 'failed',
      registeredAt: new Date(),
      expiresAt: this.calculateExpiry(options.years),
      nameservers: options.nameservers || this.defaultNameservers
    }
  }

  async setURLForwarding(
    domain: string,
    targetUrl: string,
    options = { redirect: true, includeSubdomain: true }
  ): Promise<void> {
    const [sld, tld] = this.parseDomain(domain)

    // Namecheap URL forwarding via API
    await this.apiCall('namecheap.domains.dns.setHosts', {
      SLD: sld,
      TLD: tld,
      HostRecords: [
        {
          HostName: '@',
          RecordType: options.redirect ? 'URL301' : 'URL',
          Address: targetUrl,
          TTL: 300
        },
        ...(options.includeSubdomain ? [{
          HostName: 'www',
          RecordType: options.redirect ? 'URL301' : 'URL',
          Address: targetUrl,
          TTL: 300
        }] : [])
      ]
    })
  }

  private async apiCall(command: string, params: Record<string, any>) {
    const url = new URL(this.apiUrl)
    url.searchParams.set('ApiUser', this.apiUser)
    url.searchParams.set('ApiKey', this.apiKey)
    url.searchParams.set('UserName', this.apiUser)
    url.searchParams.set('ClientIp', this.clientIp)
    url.searchParams.set('Command', command)

    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, String(value))
    })

    const response = await fetch(url.toString())
    const xmlText = await response.text()

    // Parse XML response (use xml2js or similar)
    const result = await this.parseXML(xmlText)

    if (result.Errors) {
      throw new AppError(500, result.Errors[0].Error, 'REGISTRAR_ERROR')
    }

    return result.CommandResponse
  }

  private parseDomain(domain: string): [string, string] {
    const parts = domain.split('.')
    const tld = parts.pop()!
    const sld = parts.join('.')
    return [sld, tld]
  }
}
```

**RESEARCH FLAG:** Namecheap API specifics need verification:
- Current API version and endpoint URLs
- XML response format (may need xml2js library)
- Contact info requirements (can we use reseller defaults?)
- URL forwarding vs custom DNS hosting

### Factory Pattern

```typescript
// services/registrar/factory.ts

export function createRegistrar(type: string): IRegistrar {
  switch (type) {
    case 'namecheap':
      return new NamecheapRegistrar({
        apiKey: process.env.NAMECHEAP_API_KEY!,
        apiUser: process.env.NAMECHEAP_API_USER!,
        clientIp: process.env.NAMECHEAP_CLIENT_IP!,
        sandbox: process.env.NODE_ENV !== 'production'
      })

    case 'mock':
      return new MockRegistrar()  // For testing

    default:
      throw new Error(`Unknown registrar type: ${type}`)
  }
}
```

---

## Domain Registration Flow

**Confidence:** HIGH (standard domain registration workflow)

### Complete Sequence: Request to Live Domain

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Availability Check (No Payment)                    │
└─────────────────────────────────────────────────────────────┘

GET /domains/example.com/availability
  │
  ▼
[Query Registrar API]
  │
  ├─► Available? → Return { available: true, price: "10.00" }
  └─► Taken?     → Return { available: false }


┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Registration Request (Requires Payment)            │
└─────────────────────────────────────────────────────────────┘

POST /domains/example.com/register
Body: { targetUrl: "https://content.xyz" }
  │
  ▼
[x402 Middleware]
  │
  ├─► No payment? → 402 Payment Required
  │                 Body: { amount: "10.00", recipient: "0x...", chain: "base" }
  │
  └─► Payment verified? → Continue
        │
        ▼
[Start Database Transaction]
  │
  ▼
[Check availability again] (prevent race conditions)
  │
  ├─► Taken? → Rollback, return 409 Conflict
  │
  └─► Available?
        │
        ▼
[Create pending domain record]
  │  INSERT INTO domains (name, owner_wallet, status, target_url)
  │  VALUES ('example.com', '0x...', 'pending', 'https://content.xyz')
  │
  ▼
[Register with Namecheap]
  │
  ├─► Success?
  │     │
  │     ▼
  │   [Update domain record]
  │     │  UPDATE domains SET status = 'active', registered_at = NOW()
  │     │
  │     ▼
  │   [Configure URL forwarding]
  │     │  Namecheap API: Set URL301 record @ → target_url
  │     │
  │     ▼
  │   [Commit transaction]
  │     │
  │     └─► Return 201 Created
  │           Body: { domain: "example.com", status: "active", targetUrl: "..." }
  │
  └─► Failure?
        │
        ▼
      [Rollback transaction]
        │
        └─► Return 500 Internal Server Error
              Body: { error: "Registration failed", refundAvailable: true }


┌─────────────────────────────────────────────────────────────┐
│ Phase 3: DNS Propagation (Automatic)                        │
└─────────────────────────────────────────────────────────────┘

Namecheap configures DNS records:
  example.com     → URL301 → https://content.xyz
  www.example.com → URL301 → https://content.xyz

Propagation time: 2-5 minutes typical, up to 48 hours max


┌─────────────────────────────────────────────────────────────┐
│ Phase 4: Status Verification                                │
└─────────────────────────────────────────────────────────────┘

GET /domains/example.com/status
  │
  ▼
[Query database]
  │
  └─► Return {
        domain: "example.com",
        status: "active",
        owner: "0x...",
        targetUrl: "https://content.xyz",
        registeredAt: "2026-02-03T10:30:00Z",
        expiresAt: "2027-02-03T10:30:00Z"
      }
```

### Race Condition Handling

**Problem:** Two requests try to register same domain simultaneously.

**Solution:** Database-level locking + recheck before registration

```typescript
// Atomic check-and-register
await db.transaction(async (tx) => {
  // 1. Check if domain exists in DB
  const existing = await tx.get(
    'SELECT * FROM domains WHERE name = ? FOR UPDATE',
    [domain]
  )

  if (existing) {
    throw new AppError(409, 'Domain already registered', 'CONFLICT')
  }

  // 2. Check with registrar (still available?)
  const availability = await registrar.checkAvailability(domain)
  if (!availability.available) {
    throw new AppError(409, 'Domain no longer available', 'CONFLICT')
  }

  // 3. Create pending record
  await tx.run(
    'INSERT INTO domains (name, owner_wallet, status) VALUES (?, ?, ?)',
    [domain, walletAddress, 'pending']
  )

  // 4. Register with provider (outside transaction but record exists)
  // If this fails, transaction rollback removes pending record
})
```

---

## URL Mapping Strategy

**Confidence:** MEDIUM (domain forwarding patterns well-understood)

### Approach: DNS-Level URL Forwarding

For v1.0, use registrar's built-in URL forwarding rather than custom nameservers.

**Why URL forwarding over custom DNS?**

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **URL Forwarding** (Namecheap feature) | Simple, built-in, immediate | Limited to HTTP redirects, no custom DNS | ✅ **Use for v1** |
| **Custom Nameservers** + Proxy | Full DNS control, custom logic | Requires hosting DNS server, more complex | Defer to v2 |
| **CNAME to proxy** | Flexible routing | Requires proxy infrastructure | Defer to v2 |

### URL Forwarding Implementation

**How it works:**

1. Domain registered with Namecheap nameservers
2. DNS record set to URL301 type (or URL for masked)
3. Namecheap handles HTTP redirect at DNS level
4. User visits `example.com` → 301 redirect → `target-url`

**Configuration via Namecheap API:**

```typescript
await registrar.setURLForwarding('example.com', 'https://content.xyz', {
  redirect: true,           // 301 redirect (vs masked forwarding)
  includeSubdomain: true    // www.example.com also redirects
})
```

**DNS Records Created:**

```
example.com     IN URL301 https://content.xyz
www.example.com IN URL301 https://content.xyz
```

### Redirect Types

| Type | Behavior | Use Case |
|------|----------|----------|
| **URL301** (Permanent) | Browser redirects, updates address bar | Default - SEO-friendly |
| **URL** (Masked/Frame) | Shows original domain, iframes target | Alternative if requested |

**Recommendation:** Default to URL301 (permanent redirect) for transparency and SEO.

### Updating Target URL

```typescript
// PUT /domains/:name/target (requires x402 payment)
domains.put('/:name/target',
  x402Auth({ amount: '1.00' }),  // Small fee to prevent abuse
  async (c) => {
    const domain = c.req.param('name')
    const { targetUrl } = await c.req.json()
    const walletAddress = c.get('walletAddress')

    // Verify ownership
    const domainRecord = await db.getDomain(domain)
    if (domainRecord.owner !== walletAddress) {
      throw new AppError(403, 'Not domain owner', 'FORBIDDEN')
    }

    // Update registrar
    await registrar.setURLForwarding(domain, targetUrl)

    // Update database
    await db.updateDomain(domain, { targetUrl, updatedAt: new Date() })

    return c.json({ domain, targetUrl, status: 'updated' })
  }
)
```

### Future: Custom DNS (v2.0+)

For advanced use cases (MX records, subdomains, API routing):

1. Host authoritative DNS server (e.g., PowerDNS, CoreDNS)
2. Point domains to custom nameservers
3. Implement dynamic DNS records via database
4. Handle A/AAAA/CNAME/MX/TXT records

**Not needed for v1** - URL forwarding covers core agent use case.

---

## Database Design

**Confidence:** HIGH (standard SQLite patterns with better-sqlite3)

### Schema

```sql
-- domains table: Core domain registrations
CREATE TABLE domains (
  id TEXT PRIMARY KEY,              -- UUID v4
  name TEXT UNIQUE NOT NULL,        -- Domain name (e.g., "example.com")
  owner_wallet TEXT NOT NULL,       -- Ethereum wallet that paid
  status TEXT NOT NULL,             -- 'pending' | 'active' | 'failed' | 'expired'
  target_url TEXT NOT NULL,         -- Where domain points

  -- Registrar info
  registrar TEXT NOT NULL DEFAULT 'namecheap',
  registrar_id TEXT,                -- Registrar's internal ID

  -- Timestamps
  created_at INTEGER NOT NULL,      -- Unix timestamp (milliseconds)
  registered_at INTEGER,            -- When registration succeeded
  expires_at INTEGER,               -- Domain expiry (typically +1 year)
  updated_at INTEGER,               -- Last update timestamp

  -- Metadata
  price_paid TEXT,                  -- USDC amount paid (decimal string)
  payment_tx TEXT                   -- USDC transaction hash
);

CREATE INDEX idx_domains_owner ON domains(owner_wallet);
CREATE INDEX idx_domains_status ON domains(status);
CREATE INDEX idx_domains_expires ON domains(expires_at);


-- payments table: Payment records (for accounting/auditing)
CREATE TABLE payments (
  id TEXT PRIMARY KEY,              -- UUID v4
  domain_name TEXT NOT NULL,        -- Associated domain
  wallet_address TEXT NOT NULL,     -- Payer wallet
  amount TEXT NOT NULL,             -- USDC amount (decimal string)
  tx_hash TEXT UNIQUE NOT NULL,     -- Blockchain transaction hash
  chain TEXT NOT NULL DEFAULT 'base', -- Blockchain network
  purpose TEXT NOT NULL,            -- 'registration' | 'update' | 'renewal'

  created_at INTEGER NOT NULL,      -- Unix timestamp (milliseconds)

  FOREIGN KEY (domain_name) REFERENCES domains(name)
);

CREATE INDEX idx_payments_wallet ON payments(wallet_address);
CREATE INDEX idx_payments_tx ON payments(tx_hash);


-- api_logs table: Request logging (optional, for debugging)
CREATE TABLE api_logs (
  id TEXT PRIMARY KEY,              -- UUID v4
  method TEXT NOT NULL,             -- HTTP method
  path TEXT NOT NULL,               -- Request path
  wallet_address TEXT,              -- If authenticated
  status_code INTEGER NOT NULL,     -- Response status
  duration_ms INTEGER NOT NULL,     -- Request duration
  error TEXT,                       -- Error message if failed

  created_at INTEGER NOT NULL       -- Unix timestamp (milliseconds)
);

CREATE INDEX idx_api_logs_created ON api_logs(created_at);
CREATE INDEX idx_api_logs_wallet ON api_logs(wallet_address);
```

### SQLite-Specific Considerations

**1. UUID Handling**

SQLite doesn't have native UUID type. Use TEXT with validation.

```typescript
import { randomUUID } from 'crypto'

function generateId(): string {
  return randomUUID()  // e.g., "550e8400-e29b-41d4-a716-446655440000"
}
```

**2. Timestamp Strategy**

Store as INTEGER (milliseconds since epoch) for:
- Efficient sorting/indexing
- SQLite's numeric comparison
- JavaScript compatibility

```typescript
function now(): number {
  return Date.now()  // Milliseconds since epoch
}

// When querying
const domain = await db.get('SELECT * FROM domains WHERE id = ?', [id])
const registeredAt = new Date(domain.registered_at)  // Convert back to Date
```

**3. Decimal Precision for Currency**

Store USDC amounts as TEXT (decimal strings) to avoid floating-point issues.

```typescript
// GOOD: String decimals
{ pricePaid: "10.00" }

// BAD: Floating point
{ pricePaid: 10.0 }  // Can become 9.999999...
```

**4. better-sqlite3 Patterns**

```typescript
// services/database/client.ts
import Database from 'better-sqlite3'

export class DatabaseClient {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')  // Write-Ahead Logging for concurrency
    this.db.pragma('foreign_keys = ON')   // Enforce foreign key constraints
  }

  // Prepared statements for performance
  private insertDomainStmt = this.db.prepare(`
    INSERT INTO domains (id, name, owner_wallet, status, target_url, created_at, price_paid, payment_tx)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  insertDomain(domain: DomainRecord): void {
    this.insertDomainStmt.run(
      domain.id,
      domain.name,
      domain.ownerWallet,
      domain.status,
      domain.targetUrl,
      domain.createdAt,
      domain.pricePaid,
      domain.paymentTx
    )
  }

  // Transactions for atomicity
  registerDomainTransaction = this.db.transaction((domain: DomainRecord) => {
    this.insertDomainStmt.run(...)
    this.insertPaymentStmt.run(...)
  })

  // Query methods
  getDomain(name: string): DomainRecord | undefined {
    return this.db.prepare('SELECT * FROM domains WHERE name = ?').get(name)
  }

  getDomainsByOwner(wallet: string): DomainRecord[] {
    return this.db.prepare(
      'SELECT * FROM domains WHERE owner_wallet = ? ORDER BY created_at DESC'
    ).all(wallet)
  }
}
```

### Migration Strategy

**Approach:** Simple sequential migrations (no complex framework needed for v1)

```typescript
// services/database/migrations.ts

const migrations = [
  {
    version: 1,
    up: `
      CREATE TABLE domains (...);
      CREATE INDEX idx_domains_owner ON domains(owner_wallet);
    `
  },
  {
    version: 2,
    up: `
      CREATE TABLE payments (...);
      CREATE INDEX idx_payments_wallet ON payments(wallet_address);
    `
  }
  // Future migrations added here
]

export function runMigrations(db: Database.Database): void {
  // Create migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)

  // Get current version
  const currentVersion = db.prepare(
    'SELECT MAX(version) as version FROM migrations'
  ).get()?.version || 0

  // Apply pending migrations
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      console.log(`Applying migration ${migration.version}...`)
      db.exec(migration.up)
      db.prepare('INSERT INTO migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        Date.now()
      )
    }
  }
}
```

---

## Transaction Safety

**Confidence:** HIGH (standard database transaction patterns)

### The Problem: Payment + Registration Atomicity

**Scenario:** Payment succeeds, but domain registration fails. What happens?

```
1. x402 payment verified ✅ (USDC transferred on-chain)
2. Database record created ✅
3. Namecheap registration fails ❌ (API error, domain taken, etc.)

Problem: User paid but didn't get domain.
```

### Solution: Multi-Layer Transaction Handling

**Layer 1: Database Transaction (Immediate Rollback)**

```typescript
async function registerDomain(domain: string, walletAddress: string, targetUrl: string) {
  // Payment already verified by x402 middleware at this point

  return await db.transaction(async (tx) => {
    // 1. Create pending domain record
    const domainId = generateId()
    await tx.run(`
      INSERT INTO domains (id, name, owner_wallet, status, target_url, created_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `, [domainId, domain, walletAddress, targetUrl, now()])

    // 2. Record payment
    await tx.run(`
      INSERT INTO payments (id, domain_name, wallet_address, amount, tx_hash, purpose, created_at)
      VALUES (?, ?, ?, ?, ?, 'registration', ?)
    `, [generateId(), domain, walletAddress, pricePaid, txHash, now()])

    // 3. Register with Namecheap (CRITICAL POINT)
    try {
      const registration = await registrar.registerDomain(domain, {
        years: 1,
        contacts: getDefaultContacts(),
      })

      // 4. Configure URL forwarding
      await registrar.setURLForwarding(domain, targetUrl)

      // 5. Update domain to active
      await tx.run(`
        UPDATE domains
        SET status = 'active', registered_at = ?, registrar_id = ?
        WHERE id = ?
      `, [now(), registration.registrarId, domainId])

      return { status: 'success', domainId }

    } catch (error) {
      // Registration failed - database transaction will rollback
      // But payment is already on-chain (non-reversible)

      // Mark domain as failed for manual intervention
      await tx.run(`
        UPDATE domains SET status = 'failed' WHERE id = ?
      `, [domainId])

      throw new AppError(
        500,
        'Domain registration failed. Support will contact you for refund.',
        'REGISTRATION_FAILED'
      )
    }
  })
}
```

**Layer 2: Manual Intervention System**

Failed registrations need human review:

```sql
-- Query failed registrations
SELECT
  d.name,
  d.owner_wallet,
  p.amount,
  p.tx_hash,
  d.created_at
FROM domains d
JOIN payments p ON d.name = p.domain_name
WHERE d.status = 'failed'
ORDER BY d.created_at DESC;
```

**Options for failed registrations:**

1. **Retry registration** (if transient Namecheap error)
2. **Manual refund** (send USDC back to owner_wallet)
3. **Alternative domain** (contact user, offer different domain)

**Layer 3: Idempotency for Retries**

Use payment transaction hash as idempotency key:

```typescript
// Check if payment already processed
const existingPayment = await db.prepare(
  'SELECT * FROM payments WHERE tx_hash = ?'
).get(txHash)

if (existingPayment) {
  // Payment already processed, return existing domain
  const domain = await db.getDomain(existingPayment.domain_name)
  return c.json({ domain, message: 'Already registered' }, 200)
}

// Proceed with registration
```

### Failure Scenarios & Handling

| Scenario | Handling |
|----------|----------|
| **Payment fails** | x402 middleware rejects request, no DB changes |
| **Domain taken (race condition)** | Recheck availability in transaction, rollback if taken, return 409 |
| **Namecheap API error** | Rollback DB transaction, mark as 'failed', manual review |
| **URL forwarding fails** | Domain registered but not pointing correctly - retry forwarding in background job |
| **Database crash during transaction** | SQLite WAL mode ensures atomic commits, pending changes lost |

### Background Retry Job (Optional for v1.1)

For transient Namecheap failures:

```typescript
// Retry failed registrations
setInterval(async () => {
  const failedDomains = await db.prepare(`
    SELECT * FROM domains
    WHERE status = 'failed'
    AND created_at > ?
    LIMIT 10
  `).all(now() - 24 * 60 * 60 * 1000)  // Last 24 hours

  for (const domain of failedDomains) {
    try {
      await registrar.registerDomain(domain.name, {...})
      await db.updateDomainStatus(domain.id, 'active')
      console.log(`Recovered failed registration: ${domain.name}`)
    } catch (error) {
      console.error(`Retry failed for ${domain.name}:`, error)
    }
  }
}, 60 * 60 * 1000)  // Every hour
```

---

## Deployment Architecture

**Confidence:** MEDIUM (Railway/Fly.io patterns from training, specific features may have changed)

### Target Platforms

x402names must support:
1. **Railway** - Primary deployment target
2. **Fly.io** - Alternative for geographic distribution
3. **Self-hosted** - VPS/bare metal for independent operators

### Railway Deployment

**Structure:**

```
x402names-production
  ├─ Service: api (Hono app)
  │   ├─ Build: npm run build
  │   ├─ Start: npm start
  │   └─ Port: 3000
  │
  └─ Volume: sqlite-data
      ├─ Mount: /data
      └─ File: /data/x402names.db
```

**railway.json:**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

**Persistent Storage:**

Railway provides persistent volumes for SQLite:

```typescript
// config/index.ts
const dbPath = process.env.DATABASE_PATH || '/data/x402names.db'

// Ensure data directory exists
import { mkdirSync } from 'fs'
const dbDir = path.dirname(dbPath)
mkdirSync(dbDir, { recursive: true })

const db = new Database(dbPath)
```

**Environment Variables:**

```bash
# Railway environment variables
NODE_ENV=production
PORT=3000
DATABASE_PATH=/data/x402names.db

# x402 Payment
PAYMENT_WALLET=0x...  # USDC recipient address
PAYMENT_CHAIN=base

# Namecheap API
NAMECHEAP_API_KEY=...
NAMECHEAP_API_USER=...
NAMECHEAP_CLIENT_IP=...  # Railway's outbound IP (whitelist in Namecheap)

# App config
DEFAULT_CONTACT_EMAIL=domains@x402names.com
SERVICE_MARGIN=0.20  # 20% markup on registrar pricing
```

### Fly.io Deployment

**fly.toml:**

```toml
app = "x402names"
primary_region = "sjc"  # San Jose

[build]
  builder = "paketobuildpacks/builder:base"

[env]
  PORT = "8080"
  NODE_ENV = "production"

[[services]]
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    port = 80
    handlers = ["http"]

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

[mounts]
  source = "x402names_data"
  destination = "/data"
```

**Persistent Volume:**

```bash
# Create volume for SQLite
fly volumes create x402names_data --size 1  # 1GB

# Deploy with volume
fly deploy
```

### Self-Hosted Deployment

**Docker Compose:**

```yaml
version: '3.8'

services:
  api:
    image: x402names:latest
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_PATH: /data/x402names.db
      PAYMENT_WALLET: ${PAYMENT_WALLET}
      NAMECHEAP_API_KEY: ${NAMECHEAP_API_KEY}
      NAMECHEAP_API_USER: ${NAMECHEAP_API_USER}
      NAMECHEAP_CLIENT_IP: ${NAMECHEAP_CLIENT_IP}
    volumes:
      - sqlite-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  sqlite-data:
    driver: local
```

**Dockerfile:**

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Ensure data directory exists
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/x402names.db

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

### SQLite Persistence Considerations

**Critical:** SQLite requires persistent disk for data durability.

| Platform | Solution |
|----------|----------|
| **Railway** | Persistent volume mounted at `/data` |
| **Fly.io** | Fly volumes (`fly volumes create`) |
| **Docker** | Named volume or bind mount |

**Backup Strategy:**

```typescript
// Automated backups (run daily)
import { copyFileSync } from 'fs'

function backupDatabase() {
  const timestamp = new Date().toISOString().split('T')[0]
  const backupPath = `/backups/x402names-${timestamp}.db`

  copyFileSync(dbPath, backupPath)

  // Upload to S3/R2/Backblaze
  await uploadToStorage(backupPath)
}

// Schedule daily backups
setInterval(backupDatabase, 24 * 60 * 60 * 1000)
```

### Environment Configuration Pattern

**config/index.ts:**

```typescript
import { z } from 'zod'

const configSchema = z.object({
  // Server
  nodeEnv: z.enum(['development', 'production', 'test']),
  port: z.number().default(3000),

  // Database
  databasePath: z.string().default('./data/x402names.db'),

  // Payment
  paymentWallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  paymentChain: z.enum(['base', 'ethereum', 'polygon']).default('base'),

  // Namecheap
  namecheap: z.object({
    apiKey: z.string(),
    apiUser: z.string(),
    clientIp: z.string(),
    sandbox: z.boolean().default(false)
  }),

  // Business logic
  serviceMargin: z.number().min(0).max(1).default(0.20),  // 20%
  defaultContactEmail: z.string().email(),
  defaultContactPhone: z.string().default('+1.0000000000'),

  // Features
  enableApiLogs: z.boolean().default(true),
  enableBackups: z.boolean().default(true)
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(): Config {
  return configSchema.parse({
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT) || 3000,
    databasePath: process.env.DATABASE_PATH,
    paymentWallet: process.env.PAYMENT_WALLET,
    paymentChain: process.env.PAYMENT_CHAIN,
    namecheap: {
      apiKey: process.env.NAMECHEAP_API_KEY,
      apiUser: process.env.NAMECHEAP_API_USER,
      clientIp: process.env.NAMECHEAP_CLIENT_IP,
      sandbox: process.env.NODE_ENV !== 'production'
    },
    serviceMargin: Number(process.env.SERVICE_MARGIN) || 0.20,
    defaultContactEmail: process.env.DEFAULT_CONTACT_EMAIL,
    defaultContactPhone: process.env.DEFAULT_CONTACT_PHONE,
    enableApiLogs: process.env.ENABLE_API_LOGS !== 'false',
    enableBackups: process.env.ENABLE_BACKUPS !== 'false'
  })
}
```

**Benefits:**
- Type-safe configuration
- Runtime validation (fails fast on startup if misconfigured)
- Clear documentation of required environment variables
- Sensible defaults for development

---

## Build Order

**Confidence:** HIGH (dependency analysis)

Build components in order of dependencies. Each phase should be testable independently.

### Phase 1: Foundation (No external dependencies)

**Goal:** Core infrastructure that everything else depends on.

1. **Config Management**
   - `src/config/index.ts` - Environment configuration loader
   - **Test:** Load config in different environments
   - **Deliverable:** `loadConfig()` function with validation

2. **Database Layer**
   - `src/services/database/client.ts` - SQLite client wrapper
   - `src/services/database/migrations.ts` - Migration runner
   - **Test:** Create DB, run migrations, basic CRUD
   - **Deliverable:** `DatabaseClient` class

3. **Error Handling**
   - `src/utils/errors.ts` - Custom error classes
   - `src/middleware/error-handler.ts` - Global error middleware
   - **Test:** Throw various errors, verify response format
   - **Deliverable:** Standardized error responses

### Phase 2: External Integrations (Depends on Phase 1)

**Goal:** Integrate with Namecheap and x402 payment system.

4. **Registrar Interface**
   - `src/services/registrar/interface.ts` - Abstract interface
   - `src/services/registrar/mock.ts` - Mock implementation for testing
   - **Test:** Mock registrar passes all interface tests
   - **Deliverable:** `IRegistrar` interface + mock

5. **Namecheap Implementation**
   - `src/services/registrar/namecheap.ts` - Real Namecheap API client
   - `src/services/registrar/factory.ts` - Factory pattern
   - **Test:** Check availability, register domain (sandbox), set URL forwarding
   - **Deliverable:** Working Namecheap integration

6. **x402 Payment Middleware**
   - `src/middleware/x402-auth.ts` - Payment verification wrapper
   - **Test:** Mock payment proofs, verify middleware behavior
   - **Deliverable:** `x402Auth()` middleware factory
   - **BLOCKER:** Requires @openfacilitator/sdk documentation

### Phase 3: Business Logic (Depends on Phase 1 & 2)

**Goal:** Core domain registration workflows.

7. **Domain Service**
   - `src/services/domain.ts` - Business logic layer
   - Functions: `checkAvailability()`, `registerDomain()`, `updateTarget()`, `getDomainInfo()`
   - **Test:** End-to-end flows with mock registrar
   - **Deliverable:** Reusable service layer

8. **Transaction Handling**
   - Database transactions wrapping registrar calls
   - Rollback logic for failures
   - **Test:** Simulate Namecheap failures, verify rollback
   - **Deliverable:** Atomic registration process

### Phase 4: HTTP API (Depends on Phase 1-3)

**Goal:** Expose functionality via HTTP endpoints.

9. **Route Handlers**
   - `src/routes/domains.ts` - Domain endpoints
   - `src/routes/health.ts` - Health check
   - **Test:** HTTP request/response tests (without payment)
   - **Deliverable:** All API endpoints implemented

10. **Hono App Assembly**
    - `src/app.ts` - Middleware chain, route mounting
    - `src/index.ts` - Server startup
    - **Test:** Integration tests with real HTTP requests
    - **Deliverable:** Running HTTP server

### Phase 5: Production Readiness (Depends on Phase 4)

**Goal:** Deploy-ready application.

11. **Logging & Monitoring**
    - Request logging middleware
    - API logs table + queries
    - **Test:** Verify logs are written correctly
    - **Deliverable:** Observable application

12. **Deployment Configuration**
    - `Dockerfile` - Container image
    - `railway.json` - Railway config
    - `fly.toml` - Fly.io config
    - `.env.example` - Environment variable template
    - **Test:** Deploy to staging environment
    - **Deliverable:** Production deployment

### Dependency Graph

```
Phase 1: Foundation
  ├─ Config
  ├─ Database
  └─ Error Handling

Phase 2: Integrations (depends on Phase 1)
  ├─ Registrar Interface
  ├─ Namecheap Implementation
  └─ x402 Middleware

Phase 3: Business Logic (depends on Phase 1 & 2)
  ├─ Domain Service
  └─ Transaction Handling

Phase 4: HTTP API (depends on Phase 1-3)
  ├─ Route Handlers
  └─ Hono App

Phase 5: Production (depends on Phase 4)
  ├─ Logging
  └─ Deployment
```

### Critical Path

**Must complete in order:**

1. Database + Config (foundation)
2. Registrar Interface + Mock (enables testing without real API)
3. Domain Service (business logic)
4. Route Handlers (exposes via HTTP)
5. x402 Middleware (payment protection)
6. Namecheap Implementation (replace mock)

**Can parallelize:**

- Error handling + Logging (independent utilities)
- Deployment configs (can prepare while building)
- Documentation (ongoing throughout)

---

## Integration Points

**Confidence:** MEDIUM (integration patterns well-understood, specific SDK details need verification)

### 1. Hono ↔ x402 Middleware

**Interface:**

```typescript
// Middleware provides context to route handler
app.post('/domains/:name/register',
  x402Auth({ amount: '10.00' }),
  async (c: Context) => {
    // Middleware sets these on context
    const walletAddress = c.get('walletAddress')  // string
    const txHash = c.get('txHash')                 // string
    const pricePaid = c.get('pricePaid')           // string (decimal)

    // Route handler proceeds with payment verified
  }
)
```

**Contract:**
- Middleware MUST set `walletAddress` on successful payment verification
- Middleware MUST return 402 with payment details if no payment proof
- Middleware MUST return 403 if payment proof is invalid
- Route handler can assume payment is verified

### 2. Route Handler ↔ Domain Service

**Interface:**

```typescript
// routes/domains.ts calls services/domain.ts
const result = await domainService.registerDomain({
  name: domain,
  ownerWallet: walletAddress,
  targetUrl: targetUrl,
  pricePaid: pricePaid,
  paymentTx: txHash
})
```

**Contract:**
- Service layer handles business logic + database transactions
- Service throws `AppError` for expected errors (domain taken, etc.)
- Service returns structured result on success
- Route handler only does HTTP-specific concerns (parsing, response formatting)

### 3. Domain Service ↔ Registrar

**Interface:**

```typescript
// services/domain.ts calls registrar interface
const availability = await registrar.checkAvailability(domain)
const registration = await registrar.registerDomain(domain, options)
await registrar.setURLForwarding(domain, targetUrl)
```

**Contract:**
- Registrar interface is provider-agnostic
- All registrar methods are async (network calls)
- Registrar throws on API errors (caught by service layer)
- Service layer wraps registrar calls in database transaction

### 4. Domain Service ↔ Database

**Interface:**

```typescript
// services/domain.ts calls database client
await db.transaction(async (tx) => {
  await tx.insertDomain(...)
  await tx.insertPayment(...)
  // If anything throws, transaction auto-rollbacks
})
```

**Contract:**
- Database operations within transaction are atomic
- Transaction rollback on any error
- Database client provides prepared statements for performance
- All timestamps in milliseconds (Unix epoch)

### 5. Config ↔ All Components

**Interface:**

```typescript
// All components import config
import { loadConfig } from './config'
const config = loadConfig()

// Access typed configuration
const db = new Database(config.databasePath)
const registrar = new NamecheapRegistrar(config.namecheap)
```

**Contract:**
- Config loaded once at startup
- Invalid config causes startup failure (fail fast)
- All components use config instead of `process.env` directly
- Config changes require app restart

---

## Key Architectural Decisions

| Decision | Rationale | Tradeoffs |
|----------|-----------|-----------|
| **URL Forwarding over Custom DNS** | Simpler for v1, Namecheap handles redirect | Limited to HTTP redirects, no custom logic |
| **Abstract Registrar Interface** | Swap providers without rewriting business logic | Extra abstraction layer, but worth it for flexibility |
| **SQLite over Postgres** | Simple deployment, sufficient for v1 scale | Harder to scale horizontally (solved by read replicas later) |
| **better-sqlite3 over node-sqlite3** | Synchronous API, better performance | Must run on Node.js (not edge workers) |
| **Middleware-based Auth** | Clean separation, reusable across routes | Requires x402 SDK to provide middleware interface |
| **Database Transactions for Atomicity** | Prevents partial registrations | Namecheap API outside transaction - failure requires manual intervention |
| **Decimal Strings for Currency** | Avoid floating-point precision issues | Must parse/format when displaying |
| **UUID for Primary Keys** | Distributed-friendly, no auto-increment | Slightly larger than integers |

---

## Open Research Questions

**LOW Confidence Areas (Need Official Documentation):**

1. **@openfacilitator/sdk API**
   - Exact middleware function signature
   - How payment proofs are passed (headers? body?)
   - Context variable names (walletAddress? address? wallet?)
   - Does SDK handle retry logic or must client retry?

2. **Namecheap API Current Version**
   - Current API endpoint URLs (sandbox vs production)
   - XML response format (may need xml2js library)
   - Contact info requirements (can reseller use default contacts?)
   - URL forwarding API specifics (URL vs URL301 record types)

3. **Railway Persistent Volumes**
   - Current volume mount syntax (may have changed since training)
   - Backup/snapshot features available
   - Volume size limits and pricing

4. **Fly.io Volume Details**
   - Current `fly volumes` CLI syntax
   - Cross-region replication options
   - Volume backup procedures

---

## Recommended Next Steps

1. **Verify @openfacilitator/sdk Integration**
   - Read SDK documentation thoroughly
   - Verify middleware API signature
   - Test payment flow in sandbox environment
   - **BLOCKING:** Cannot finalize Phase 2 without this

2. **Test Namecheap Sandbox API**
   - Register sandbox account
   - Test domain registration flow
   - Verify URL forwarding configuration
   - Document actual API response formats
   - **BLOCKING:** Phase 2 completion depends on this

3. **Prototype Database Layer**
   - Implement migrations
   - Test transaction rollback behavior
   - Verify SQLite WAL mode performance
   - **Can start immediately**

4. **Deploy Test Instance**
   - Deploy to Railway staging environment
   - Verify persistent volume behavior
   - Test environment configuration
   - **Can start after Phase 1 foundation**

---

## Sources & Confidence Levels

| Topic | Confidence | Source |
|-------|------------|--------|
| Hono middleware patterns | MEDIUM | Training knowledge (Jan 2025) |
| x402 payment flow | LOW | Inferred from protocol patterns |
| @openfacilitator/sdk API | LOW | SDK docs inaccessible, needs verification |
| Domain registration workflow | HIGH | Standard domain industry patterns |
| Namecheap API | MEDIUM | Training knowledge, specific APIs need verification |
| URL forwarding architecture | HIGH | DNS/HTTP redirect patterns well-established |
| SQLite schema design | HIGH | Standard SQL patterns |
| better-sqlite3 usage | MEDIUM | Training knowledge, current version may differ |
| Transaction handling | HIGH | Standard database transaction patterns |
| Railway deployment | MEDIUM | Training knowledge, current features may differ |
| Fly.io deployment | MEDIUM | Training knowledge, current features may differ |

**CRITICAL:** This architecture is buildable, but x402 SDK integration and Namecheap API specifics need verification before Phase 2 implementation.
