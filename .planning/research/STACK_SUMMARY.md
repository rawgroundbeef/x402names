# Stack Research Summary

**Project:** x402names
**Research Focus:** Technology stack and package selection
**Date:** 2026-02-03
**Confidence:** MEDIUM (web research unavailable, based on training knowledge + architectural reasoning)

---

## Quick Answer

**Core stack for x402names v1.0:**

```json
{
  "framework": "Hono v4 + @hono/node-server",
  "database": "better-sqlite3 v9",
  "payment": "@openfacilitator/sdk",
  "validation": "zod v3",
  "registrar": "Direct fetch to Namecheap API + fast-xml-parser",
  "runtime": "Node.js 18+ ESM"
}
```

**Total dependencies:** 7 production, 4 dev
**Architecture pattern:** Layered with abstract registrar interface
**Deployment target:** Railway/Fly.io with SQLite on persistent volumes

---

## Key Technology Decisions

### 1. Hono over Express

**Decision:** Use Hono v4 as HTTP framework

**Rationale:**
- 15x smaller than Express (~12KB vs ~200KB)
- ESM-native, no CommonJS interop issues
- Deployment-agnostic (works on Node.js, Bun, Cloudflare Workers)
- TypeScript-first with excellent type inference
- Built-in middleware (CORS, rate limiting)

**Tradeoff:** Smaller ecosystem than Express, but sufficient for API-only service

---

### 2. better-sqlite3 over ORMs

**Decision:** Use better-sqlite3 directly with SQL migrations, skip ORMs

**Rationale:**
- Faster than async wrappers (synchronous API)
- Simple schema doesn't justify ORM complexity
- Direct SQL is more predictable and debuggable
- Easier to reason about for domain registration logic
- Battle-tested (used by Electron, VS Code)

**Tradeoff:** Write raw SQL, but schema is simple enough that this isn't a burden

---

### 3. Direct Namecheap API Integration

**Decision:** Use native fetch + fast-xml-parser, skip npm wrappers

**Rationale:**
- Existing npm packages (namecheap-api, namecheap) are outdated/unmaintained
- Namecheap API is XML-based but straightforward
- Abstract interface pattern isolates provider-specific code
- Full control over retries and error handling
- Easier to swap registrars later

**Tradeoff:** Implement XML parsing ourselves, but gives flexibility

---

### 4. Native Node.js Features Over Dependencies

**Decisions:**
- Use `crypto.randomUUID()` instead of nanoid package
- Use native `fetch` instead of axios
- Use `console.log` for v1 instead of winston/pino

**Rationale:**
- Node.js 18+ has modern built-ins
- Fewer dependencies = smaller bundle, less maintenance
- Can add specialized libraries later if needed

---

## Architecture Layers

```
┌────────────────────────────────────────┐
│  HTTP Layer (Hono)                     │
│  - Routes: /check, /register, /update  │
│  - Middleware: CORS, validation        │
└──────────────┬─────────────────────────┘
               │
┌──────────────▼─────────────────────────┐
│  Business Logic                        │
│  - Domain availability check           │
│  - Payment verification                │
│  - Registration orchestration          │
└──────────────┬─────────────────────────┘
               │
      ┌────────┼────────┐
      │        │        │
┌─────▼──┐ ┌──▼─────┐ ┌▼──────────┐
│Payment │ │Database│ │ Registrar │
│  SDK   │ │SQLite  │ │ Interface │
└────────┘ └────────┘ └┬──────────┘
                        │
                   ┌────▼─────────┐
                   │  Namecheap   │
                   │ (fetch+XML)  │
                   └──────────────┘
```

---

## Critical Research Gaps

**Must verify before implementation:**

### 1. @openfacilitator/sdk API Surface (HIGH PRIORITY)

**Status:** Package mentioned in project docs but API unknown

**Needed:**
- Exact method signatures for payment request creation
- Payment verification function signature
- Required configuration (API keys, endpoints)
- Error handling patterns
- Payment proof format

**How to verify:**
```bash
npm view @openfacilitator/sdk
# Check npm page or GitHub repo for documentation
```

### 2. Package Version Currency (MEDIUM PRIORITY)

**Status:** All versions from January 2025 training data

**Needed:**
- Current stable versions of Hono, better-sqlite3, zod
- Breaking changes between training data and current versions

**How to verify:**
```bash
npm view hono version
npm view better-sqlite3 version
npm view zod version
npm view fast-xml-parser version
```

### 3. Namecheap Reseller API Specifics (MEDIUM PRIORITY)

**Status:** General API knowledge, but exact response schemas unknown

**Needed:**
- XML response structure for domain check/register
- URL forwarding API endpoints
- Rate limits and retry recommendations
- Sandbox vs production credential differences

**How to verify:**
- Review Namecheap reseller API documentation
- Test in sandbox environment

---

## Implementation Roadmap Implications

### Phase 1: Environment Setup
- Install and verify package versions
- Set up TypeScript + ESM configuration
- Create basic Hono server with health check endpoint
- **Blocker:** None — standard setup

### Phase 2: Database Layer
- Create SQLite schema for domains table
- Implement migration script
- Create database access layer with typed queries
- **Blocker:** None — straightforward SQL

### Phase 3: Payment Integration
- Integrate @openfacilitator/sdk
- Implement payment request generation
- Implement payment verification
- **Blocker:** CRITICAL — SDK API surface unknown

### Phase 4: Registrar Integration
- Implement abstract registrar interface
- Implement Namecheap registrar with fetch + XML parsing
- Test domain check/register in sandbox
- **Blocker:** MEDIUM — Need sandbox credentials + API docs

### Phase 5: Business Logic
- Implement domain availability endpoint
- Implement registration endpoint (orchestrate payment + registrar)
- Implement update endpoint
- **Blocker:** None once phases 3-4 complete

### Phase 6: DNS/URL Mapping
- Implement URL forwarding (301 redirect approach for v1)
- Configure wildcard DNS or Hono catch-all route
- Test end-to-end domain → URL mapping
- **Blocker:** None — standard HTTP patterns

**Phase ordering rationale:**
- Payment integration (Phase 3) can be researched in parallel with database setup
- Registrar integration (Phase 4) has longest lead time (credentials, sandbox access)
- Business logic (Phase 5) depends on both payment and registrar working

---

## Recommended Next Steps

### Immediate (Before Coding)

1. **Verify @openfacilitator/sdk exists and is usable:**
   ```bash
   npm view @openfacilitator/sdk
   # If package doesn't exist or is different, update architecture
   ```

2. **Check current package versions:**
   ```bash
   npm view hono version
   npm view better-sqlite3 version
   # Update STACK.md with actual versions
   ```

3. **Obtain Namecheap reseller credentials:**
   - Sign up for reseller account if not already done
   - Get sandbox API credentials
   - Whitelist development IP addresses

### Week 1 (Foundation)

1. Initialize project with package.json + tsconfig.json (from STACK.md)
2. Install dependencies and verify ESM setup works
3. Create basic Hono server with /health endpoint
4. Set up SQLite database with initial schema migration
5. Deploy to Railway/Fly.io to validate deployment configuration

### Week 2 (Integration)

1. Integrate @openfacilitator/sdk and test payment flow
2. Implement Namecheap registrar interface with sandbox
3. Connect database layer to business logic
4. Implement domain availability check endpoint

### Week 3 (Core Features)

1. Implement domain registration endpoint (payment + registrar)
2. Implement domain update endpoint
3. Implement URL forwarding/redirect logic
4. End-to-end testing

---

## Success Metrics

Stack is validated when:
- [ ] All packages install without errors
- [ ] TypeScript compiles with zero errors in strict mode
- [ ] ESM imports work without CommonJS shims
- [ ] Hono server starts and responds to HTTP requests
- [ ] SQLite migrations run successfully
- [ ] @openfacilitator/sdk payment verification works
- [ ] Namecheap API calls succeed in sandbox
- [ ] Deployment to Railway/Fly.io succeeds with persistent SQLite

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| @openfacilitator/sdk API differs from assumptions | HIGH | Verify package immediately; have fallback plan for payment verification |
| Namecheap API changes since training data | MEDIUM | Review official docs; test in sandbox early |
| Package versions have breaking changes | MEDIUM | Check changelogs before installing; pin versions |
| SQLite performance insufficient at scale | LOW | v1 won't have scale issues; can migrate to Postgres later via adapter pattern |
| DNS propagation delays confuse users | LOW | Document expected 2-5 min delay clearly in API responses |

---

## Alternative Stacks Considered

### Why NOT these alternatives:

**Express instead of Hono:**
- Rejected: Too heavy (200KB vs 12KB), CommonJS-first, overkill for API-only service

**Prisma/Drizzle ORM:**
- Rejected: Adds complexity for simple schema, migration overhead, performance penalty

**Bun runtime instead of Node.js:**
- Deferred: Node.js has better Railway/Fly.io support, more mature ecosystem. Consider for v2 if performance bottleneck.

**PostgreSQL instead of SQLite:**
- Deferred: SQLite sufficient for v1. Can swap via adapter layer later if needed.

**GraphQL instead of REST:**
- Rejected: Overkill for simple CRUD API, adds client complexity for agents

---

**Research complete. Ready for implementation phase.**

**Next action:** Verify @openfacilitator/sdk and current package versions, then initialize project structure.
