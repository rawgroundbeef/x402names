# x402names

## What This Is

x402names is a domain registration service powered by x402 micropayments. Agents pay USDC to register domain names and point them at any URL — IPFS content, x402.storage URLs, or arbitrary web addresses. Single API call from payment to live domain. No credit cards, no accounts, no humans required.

## Core Value

An agent can register a domain and point it at content with a single API call and a USDC payment. Zero human intervention from payment to live domain.

## Current State

**Shipped:** v1.0 Domain Registration Service (2026-02-05)
**Codebase:** 9,031 lines TypeScript, 201 tests passing
**Tech stack:** Bun + Hono + SQLite (better-sqlite3) + @x402/hono
**Deployment:** Railway, Fly.io, Docker supported

## Requirements

### Validated

- ✓ Agent can check domain availability and price — v1.0
- ✓ Agent can register a domain by paying USDC via x402 — v1.0
- ✓ Registered domain points at any user-specified URL — v1.0
- ✓ Agent can update where a domain points (small fee) — v1.0
- ✓ Agent can check registration status and DNS for any domain — v1.0
- ✓ Abstract registrar interface with Namecheap as first implementation — v1.0
- ✓ SQLite database with WAL mode and migration system — v1.0
- ✓ x402 payment middleware via @x402/hono — v1.0
- ✓ Deployment support for Railway, Fly.io, and Docker — v1.0
- ✓ Rate limiting per IP (100 req/min) — v1.0
- ✓ Domain name validation (format, length, supported TLDs) — v1.0
- ✓ Target URL validation with SSRF prevention — v1.0
- ✓ Machine-readable error codes (26 codes, agent discovery endpoint) — v1.0

### Active

(None — next milestone not yet defined)

### Out of Scope

- Domain claim/transfer flow — deferred to v1.1 when core registration is proven
- x402jobs integration — get core API working first (v1.1+)
- Auto-renewal — manual for v1, revisit based on usage patterns
- Email forwarding — not core to the agent-registers-domain story
- Subdomain management — complexity vs value tradeoff, defer
- Premium domain pricing — standard pricing sufficient for v1
- Non-IPFS-specific DNS (MX, etc.) — URL pointing covers the core use case
- Mobile/web UI — API-first, agents are the primary consumer
- Per-wallet rate limiting — payment is natural throttle for paid endpoints
- ACME/SSL provisioning for redirect server — defer until HTTPS redirect needed

## Context

- Part of the x402 autonomous agent web stack: x402.storage (content) + x402names (domains)
- Primary consumers are AI agents, not humans — API must be dead simple
- Uses `@x402/hono` for x402 payment verification
- Domains registered under x402names' reseller account (custodial model)
- Ownership tracked internally by wallet address that paid
- Domains can point at any URL (not limited to IPFS gateways)
- Pricing pulled dynamically from registrar API with service margin added

## Constraints

- **Tech stack**: Bun runtime, ESM, Hono framework, SQLite via better-sqlite3
- **Payment**: x402 protocol via @x402/hono — USDC only
- **Registrar**: Abstract interface, Namecheap reseller API as first implementation
- **Deployment**: Must support Railway, Fly.io, and self-hosting
- **DNS propagation**: Inherent delay (~2-5 min) — not a bug, document it

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hono over Express | Lightweight, modern, works everywhere | ✓ Good |
| SQLite over Postgres | Simple for v1, can swap via adapter later | ✓ Good |
| Abstract registrar interface | Swap providers without rewriting business logic | ✓ Good |
| Any-URL mapping (not IPFS-only) | Broader utility — agents point domains at any content | ✓ Good |
| Custodial domain model | Simplest v1 — domains under our reseller account, tracked by wallet | ✓ Good |
| @x402/hono for payment | Existing SDK for payment verification | ✓ Good |
| In-memory cache (300s TTL) | Fast domain-to-URL lookups for redirect server | ✓ Good |
| Separate redirect server (port 3001) | Isolates public traffic from authenticated API | ✓ Good |
| Host-based routing | Single app handles multiple domains via Hono getPath | ✓ Good |
| Flat $2.00 USDC URL update fee | Simple pricing, wallet-based ownership verification | ✓ Good |
| 100 req/min/IP rate limiting | Generous limit prevents abuse, paid endpoints excluded | ✓ Good |
| Aggregated validation errors | Agents fix all issues in one pass, not fail-fast | ✓ Good |
| Static JSON error catalog | Simple, fast, hand-crafted descriptions for agents | ✓ Good |
| RFC 9457 Problem Details | Standard error format, machine-readable for agents | ✓ Good |

## Known Tech Debt (from v1.0)

- TODO [HARD-05]: x402 payment signature server-side verification deferred
- ACME challenge placeholder returns 404 (SSL provisioning not implemented)
- createPaymentMiddleware factory exported but unused
- system table defined in schema but unused
- Per-wallet rate limiting not implemented (per-IP only)

---
*Last updated: 2026-02-05 after v1.0 milestone*
