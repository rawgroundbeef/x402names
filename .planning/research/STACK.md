# Stack Research: x402names

**Project:** x402names Domain Registration Service
**Researched:** 2026-02-03
**Overall Confidence:** MEDIUM (Web research tools unavailable, based on training knowledge through January 2025)

## Executive Summary

x402names requires a lightweight, ESM-native Node.js stack optimized for API performance and deployment flexibility. The core stack centers on Hono (modern HTTP framework), better-sqlite3 (embedded database), and @openfacilitator/sdk (x402 payment verification). The registrar integration layer uses direct REST API calls (no wrapper needed) with an abstract interface pattern.

**Key architectural constraint:** Node.js ESM-native throughout. No CommonJS interop issues.

---

## Core Framework

### Hono v4.x

**Package:** `hono`
**Recommended Version:** `^4.0.0` (MEDIUM confidence — latest as of training cutoff)
**Purpose:** HTTP API framework

**Why Hono:**
- **Lightweight:** ~12KB, minimal overhead vs Express (~200KB)
- **ESM-native:** Built for modern Node.js, no CommonJS baggage
- **Deployment-agnostic:** Same code runs on Node.js, Bun, Cloudflare Workers, Deno
- **TypeScript-first:** Excellent type inference for routes and middleware
- **Middleware ecosystem:** Built-in CORS, JWT, logger, rate limiting

**Node.js Adapter:**
```typescript
import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono()
// routes...

serve(app, (info) => {
  console.log(`Listening on http://localhost:${info.port}`)
})
```

**Installation:**
```bash
npm install hono @hono/node-server
```

**Confidence Level:** HIGH for Hono choice (proven framework), MEDIUM for exact version (unable to verify current release)

**Sources:** Based on Hono documentation patterns as of training cutoff. REQUIRES VERIFICATION against current docs.

---

## Payment Verification

### @openfacilitator/sdk

**Package:** `@openfacilitator/sdk`
**Recommended Version:** `latest` (LOW confidence — package existence verified in project docs, version unknown)
**Purpose:** x402 payment protocol verification

**What it provides:**
- USDC payment request generation
- Payment verification callbacks
- x402 protocol message handling
- Wallet signature verification

**Expected usage pattern:**
```typescript
import { verifyPayment, createPaymentRequest } from '@openfacilitator/sdk'

// Create payment request for domain registration
const paymentReq = await createPaymentRequest({
  amount: domainPrice,
  currency: 'USDC',
  recipient: process.env.PAYMENT_WALLET_ADDRESS,
  metadata: { domain: 'example.com', action: 'register' }
})

// Verify payment was received
const isValid = await verifyPayment(paymentProof)
```

**Integration points:**
1. Domain availability endpoint returns payment request
2. Registration endpoint verifies payment before calling registrar
3. Update endpoint verifies small update fee payment

**Confidence Level:** LOW (package mentioned in project docs but unable to verify API surface)

**Critical research gap:** Exact API methods, authentication requirements, and error handling patterns need verification from package documentation or source code.

---

## Database

### better-sqlite3 v9.x

**Package:** `better-sqlite3`
**Recommended Version:** `^9.0.0` (MEDIUM confidence)
**Purpose:** SQLite embedded database with synchronous API

**Why better-sqlite3:**
- **Performance:** Faster than node-sqlite3 (async wrapper overhead)
- **Simplicity:** Synchronous API is easier to reason about
- **Reliability:** Battle-tested, used by Electron, VS Code
- **Type-safe:** Works well with TypeScript
- **Zero config:** No database server to manage

**Schema Management Pattern:**

Use explicit migration files, NOT an ORM. Keep it simple:

```typescript
// db/migrations/001_initial.sql
CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  owner_wallet TEXT NOT NULL,
  target_url TEXT NOT NULL,
  registrar_id TEXT,
  status TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_domains_owner ON domains(owner_wallet);
CREATE INDEX idx_domains_status ON domains(status);
```

```typescript
// db/migrate.ts
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

export function migrate(dbPath: string) {
  const db = new Database(dbPath)
  const migrations = fs.readdirSync('db/migrations').sort()

  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)

  const applied = db.prepare('SELECT name FROM migrations').all()
  const appliedNames = new Set(applied.map(m => m.name))

  for (const file of migrations) {
    if (!appliedNames.has(file)) {
      const sql = fs.readFileSync(path.join('db/migrations', file), 'utf-8')
      db.exec(sql)
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now())
      console.log(`Applied migration: ${file}`)
    }
  }

  db.close()
}
```

**Why NOT use an ORM:**
- Drizzle/Prisma add complexity for simple queries
- SQLite schema is straightforward
- Direct SQL is faster and more predictable
- Easier to reason about for debugging

**Confidence Level:** HIGH (well-established library with stable API)

---

## Registrar Integration

### Namecheap API — Direct REST Integration

**No npm wrapper recommended.** Use native `fetch` (Node.js 18+).

**Why no wrapper:**
- Namecheap API is XML-based and simple
- Existing npm packages (namecheap-api, namecheap) are outdated or poorly maintained
- Direct fetch gives full control over retries, error handling
- Abstract interface means provider-specific code is isolated anyway

**Architecture Pattern:**

```typescript
// registrars/interface.ts
export interface DomainRegistrar {
  checkAvailability(domain: string): Promise<{ available: boolean; price: number }>
  register(domain: string, years: number, nameservers: string[]): Promise<{ id: string }>
  updateNameservers(domain: string, nameservers: string[]): Promise<void>
  getDomainInfo(domain: string): Promise<{ status: string; expiresAt: Date }>
}

// registrars/namecheap.ts
export class NamecheapRegistrar implements DomainRegistrar {
  private apiKey: string
  private apiUser: string
  private apiUrl = 'https://api.namecheap.com/xml.response'

  async checkAvailability(domain: string) {
    const params = new URLSearchParams({
      ApiUser: this.apiUser,
      ApiKey: this.apiKey,
      Command: 'namecheap.domains.check',
      DomainList: domain,
      // ... other params
    })

    const response = await fetch(`${this.apiUrl}?${params}`)
    const xml = await response.text()
    // Parse XML, extract availability + price
    return { available: true, price: 12.99 }
  }

  // ... other methods
}
```

**XML Parsing:**

Use `fast-xml-parser` (lightweight, fast, ESM-compatible):

```bash
npm install fast-xml-parser
```

**Namecheap API Key Requirements:**
- Reseller account (not retail)
- API whitelisted IP addresses
- Sandbox vs production endpoints

**Confidence Level:** MEDIUM (Namecheap API documented but exact XML response structure needs verification)

---

## DNS/URL Mapping

### How to Make Domains Point at Any URL

**There are two approaches:**

#### 1. DNS CNAME + URL Forwarding (Recommended for v1)

**How it works:**
- Set up a wildcard A record pointing all registered domains to your server IP
- Your Hono server handles all requests and responds with 301/302 redirects

**Implementation:**
```typescript
// At Namecheap: Set nameservers to point to your hosting provider
// Or: Use Namecheap URL forwarding API

// In Hono:
app.get('*', async (c) => {
  const domain = c.req.header('host')
  const mapping = db.prepare('SELECT target_url FROM domains WHERE name = ?').get(domain)

  if (mapping) {
    return c.redirect(mapping.target_url, 301)
  }

  return c.text('Domain not found', 404)
})
```

**Pros:**
- Simple to implement
- Works immediately after DNS propagation
- No ongoing maintenance

**Cons:**
- User sees redirect in browser (URL changes)
- Extra hop adds latency

#### 2. DNS CNAME + Reverse Proxy (Better UX, more complex)

**How it works:**
- Point domain CNAME at your server
- Server fetches target URL content and serves it
- User never sees redirect

**Implementation:**
```typescript
app.get('*', async (c) => {
  const domain = c.req.header('host')
  const mapping = db.prepare('SELECT target_url FROM domains WHERE name = ?').get(domain)

  if (mapping) {
    const response = await fetch(mapping.target_url)
    return new Response(response.body, {
      headers: response.headers,
      status: response.status
    })
  }

  return c.text('Domain not found', 404)
})
```

**Pros:**
- Seamless UX (URL stays the same)
- Can inject custom headers

**Cons:**
- Higher server load (every request proxied)
- Potential CORS issues
- More complex error handling

**Recommendation for v1:** Start with URL forwarding (approach 1). Add proxy mode as optional feature later if users request it.

**DNS Management Libraries:**

For programmatic DNS record updates:

- **Use registrar APIs directly** for nameserver changes (Namecheap, GoDaddy, etc.)
- **Consider Cloudflare API** if you want finer-grained DNS control (A, CNAME, TXT records)
  - Package: `cloudflare` (unofficial) or direct fetch to Cloudflare API
  - But: Adds complexity, overkill for v1

**Confidence Level:** HIGH (standard DNS patterns)

---

## Supporting Libraries

### UUID Generation

**Recommendation:** Use native `crypto.randomUUID()`

```typescript
import { randomUUID } from 'crypto'

const domainId = randomUUID() // Built-in, cryptographically secure
```

**Why NOT nanoid:**
- crypto.randomUUID() is Node.js built-in (v14.17+)
- UUID v4 is universally recognized format
- No extra dependency
- nanoid is great for shorter IDs, but UUID is fine for SQLite primary keys

**Confidence Level:** HIGH (Node.js built-in)

---

### Environment Configuration

**Recommendation:** Use `dotenv` for development, native `process.env` in production

```bash
npm install dotenv
npm install -D @types/node
```

```typescript
// config.ts
import 'dotenv/config' // Loads .env file in development

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  databasePath: process.env.DATABASE_PATH || './data/x402names.db',
  namecheapApiKey: process.env.NAMECHEAP_API_KEY!,
  namecheapApiUser: process.env.NAMECHEAP_API_USER!,
  paymentWallet: process.env.PAYMENT_WALLET_ADDRESS!,
}
```

**Confidence Level:** HIGH (standard pattern)

---

### Input Validation

**Recommendation:** Use `zod` for TypeScript-native schema validation

```bash
npm install zod
```

```typescript
import { z } from 'zod'

const RegisterDomainSchema = z.object({
  domain: z.string().regex(/^[a-z0-9-]+\.[a-z]{2,}$/),
  targetUrl: z.string().url(),
  paymentProof: z.string(),
})

app.post('/register', async (c) => {
  const body = await c.req.json()
  const { domain, targetUrl, paymentProof } = RegisterDomainSchema.parse(body)
  // ... proceed with validated data
})
```

**Why zod:**
- TypeScript-first (type inference)
- Runtime validation
- Great error messages
- Lightweight

**Alternatives considered:**
- **joi:** CommonJS-first, larger bundle
- **yup:** Good but less TypeScript integration
- **ajv:** JSON Schema-based, overkill for simple API

**Confidence Level:** HIGH (zod is standard for modern TypeScript projects)

---

### XML Parsing (for Namecheap API)

**Recommendation:** `fast-xml-parser`

```bash
npm install fast-xml-parser
```

```typescript
import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser()
const result = parser.parse(xmlString)
```

**Why fast-xml-parser:**
- Fast and lightweight
- ESM-compatible
- Active maintenance
- Simple API

**Confidence Level:** MEDIUM (common choice but unable to verify current status)

---

### HTTP Client (optional)

**Recommendation:** Use native `fetch` (Node.js 18+)

No need for `axios` or `node-fetch`. Native fetch is sufficient for:
- Namecheap API calls
- x402 payment verification
- Reverse proxy fetching

**Only add a client library if:**
- You need advanced retry logic (consider `ky` or `ofetch`)
- You need request/response interceptors

**Confidence Level:** HIGH (Node.js 18+ has native fetch)

---

## TypeScript + ESM Configuration

### package.json

```json
{
  "name": "x402names",
  "version": "1.0.0",
  "type": "module",
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "hono": "^4.0.0",
    "@hono/node-server": "^1.0.0",
    "@openfacilitator/sdk": "latest",
    "better-sqlite3": "^9.0.0",
    "fast-xml-parser": "^4.3.0",
    "zod": "^3.22.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0"
  }
}
```

**Notes:**
- `"type": "module"` enables ESM
- `tsx` for development (TypeScript execution + watch mode)
- `@types/better-sqlite3` for SQLite types

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Key settings:**
- `"module": "ES2022"` for native ESM output
- `"moduleResolution": "bundler"` for modern module resolution
- `"strict": true` for maximum type safety

**Confidence Level:** HIGH (standard ESM + TypeScript configuration)

---

## What NOT to Add

### Libraries to Avoid (and Why)

| Library | Why NOT |
|---------|---------|
| **Express** | Heavy, CommonJS-first, middleware ecosystem adds bloat. Hono is better for API-only services. |
| **Prisma/Drizzle ORM** | Overkill for simple SQLite schema. Direct SQL is faster and more predictable. Adds migration complexity. |
| **axios** | Node.js 18+ has native fetch. No need for extra HTTP client unless advanced features required. |
| **nodemon** | Use `tsx watch` instead. Modern, TypeScript-aware, faster. |
| **node-sqlite3** | Async wrapper around SQLite. better-sqlite3 is faster with synchronous API. |
| **helmet/cors middleware** | Hono has built-in CORS. Helmet security headers can be added later if needed, not MVP blocker. |
| **winston/pino logging** | console.log sufficient for v1. Add structured logging later based on operational needs. |
| **joi/yup validation** | zod is more TypeScript-native. Avoid mixing validation libraries. |
| **body-parser** | Hono handles body parsing built-in. |
| **dotenv-expand** | Unnecessary complexity. Keep env vars simple. |
| **uuid package** | Node.js has crypto.randomUUID() built-in. |

---

## Deployment Considerations

### Railway / Fly.io Compatibility

Both platforms support:
- Node.js 18+ (native fetch, crypto.randomUUID)
- SQLite with persistent volumes
- Environment variable injection

**Railway:**
```toml
# railway.toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "npm run migrate && npm start"
```

**Fly.io:**
```toml
# fly.toml
[build]
  builder = "dockerfile"

[[services]]
  internal_port = 3000
  protocol = "tcp"

[mounts]
  source = "x402names_data"
  destination = "/data"
```

**SQLite Persistence:**
- Railway: Persistent volumes (configure in dashboard)
- Fly.io: Volumes (specify in fly.toml)
- Both: Back up SQLite file periodically to object storage

**Confidence Level:** MEDIUM (deployment platforms evolve, verify current docs)

---

## Recommended package.json Dependencies

### Full Dependency List with Versions

```json
{
  "dependencies": {
    "hono": "^4.0.0",
    "@hono/node-server": "^1.0.0",
    "@openfacilitator/sdk": "latest",
    "better-sqlite3": "^9.0.0",
    "fast-xml-parser": "^4.3.0",
    "zod": "^3.22.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0"
  }
}
```

**Total production dependencies:** 7 packages
**Total dev dependencies:** 4 packages

**Bundle size estimate:** ~5MB node_modules (mostly better-sqlite3 native binaries)

---

## Integration Architecture

### How Packages Fit Together

```
┌─────────────────────────────────────────────────┐
│  Hono HTTP Server (@hono/node-server)           │
│  - Routing                                       │
│  - Request/response handling                     │
│  - CORS, middleware                              │
└────────────┬────────────────────────────────────┘
             │
             ├─► zod (input validation)
             │
             ├─► @openfacilitator/sdk
             │   └─► Payment verification
             │
             ├─► better-sqlite3
             │   └─► Domain ownership tracking
             │       Payment history
             │
             └─► Registrar Interface
                 ├─► NamecheapRegistrar
                 │   ├─► fetch (native)
                 │   └─► fast-xml-parser
                 │
                 └─► [Future: GoDaddyRegistrar, etc.]
```

---

## Critical Research Gaps

**These require verification before implementation:**

1. **@openfacilitator/sdk API surface**
   - Exact method signatures
   - Authentication requirements
   - Error handling patterns
   - Payment proof format
   - **Action:** Check npm page or GitHub repo for documentation

2. **Namecheap Reseller API specifics**
   - Exact XML response schemas
   - URL forwarding API endpoints
   - Rate limits and retry logic
   - Sandbox vs production credentials
   - **Action:** Review official Namecheap API docs

3. **Current package versions**
   - All versions listed are based on training data (January 2025)
   - **Action:** Verify with `npm view <package> version` before installation

---

## Summary Recommendations

### Immediate Actions

1. **Verify package versions:**
   ```bash
   npm view hono version
   npm view better-sqlite3 version
   npm view @openfacilitator/sdk version
   npm view fast-xml-parser version
   npm view zod version
   ```

2. **Test @openfacilitator/sdk:**
   - Install package
   - Review documentation
   - Test payment request/verification flow
   - Document actual API surface

3. **Set up Namecheap sandbox:**
   - Obtain reseller API credentials
   - Test domain check/register API calls
   - Document XML response structures

### Success Criteria

Stack is production-ready when:
- [ ] All package versions verified as current/stable
- [ ] @openfacilitator/sdk payment flow tested end-to-end
- [ ] Namecheap API integration tested in sandbox
- [ ] ESM imports working without CommonJS shims
- [ ] TypeScript compilation error-free
- [ ] SQLite migrations run successfully
- [ ] Hono server starts and responds to test requests

---

**Last updated:** 2026-02-03
**Confidence:** MEDIUM overall (web research unavailable, based on training knowledge)
**Next:** Verify package versions and API surfaces before implementation
