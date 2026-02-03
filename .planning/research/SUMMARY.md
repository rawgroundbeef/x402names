# Research Summary: x402names

**Synthesized:** 2026-02-03
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
**Overall Confidence:** MEDIUM

## Overview

Researched the domain registration ecosystem for building x402names — an agent-first domain registration API powered by x402 micropayments. Four dimensions explored: technology stack, feature landscape, system architecture, and implementation pitfalls.

## Key Findings

### Stack

**Core packages (7 production dependencies):**
- **Hono v4** + @hono/node-server — lightweight HTTP framework, ESM-native
- **better-sqlite3 v9** — synchronous SQLite with WAL mode
- **@openfacilitator/sdk** — x402 payment verification (API needs verification)
- **zod v3** — input validation
- **fast-xml-parser v4** — Namecheap XML response parsing
- **dotenv** — environment configuration

**Key decisions:** Use native fetch (no axios), crypto.randomUUID() (no uuid package), skip ORMs. TypeScript ESM throughout with `tsx` for development.

### Features

**Table stakes for v1:**
- Domain availability check with dynamic pricing
- Registration with payment verification
- URL forwarding (HTTP 301 redirects — simplest approach)
- Ownership tracking by wallet address
- Status lookup
- DNS/URL update for owned domains
- Comprehensive error handling with machine-readable codes
- Idempotency via x402 payment ID

**Differentiators:**
- Single-call registration (payment + register in one request)
- No account required (wallet = identity)
- Agent-optimized responses (structured JSON, boolean flags)
- Zero-configuration DNS (domain points at URL, no DNS knowledge needed)

**Anti-features (do NOT build in v1):**
- Auto-renewal, domain transfers, custom nameservers, email forwarding
- Bulk operations, premium domains, multi-year registration
- Domain parking pages, contact info customization

### Architecture

**Layered structure:**
1. HTTP Layer (Hono routes + middleware)
2. Business Logic (domain service)
3. Integration Layer (registrar interface, payment middleware)
4. Data Layer (SQLite + better-sqlite3)

**URL forwarding approach:** HTTP 301 redirects. Set domain A record to x402names server, redirect to target URL. Simple, works for any URL, low infrastructure cost. Upgrade path to proxy later.

**Build order (dependency-driven):**
1. Foundation: config, database, error handling
2. Integrations: registrar interface + mock, Namecheap adapter, x402 middleware
3. Business logic: domain service with transactions
4. HTTP API: route handlers, Hono app
5. Production: deployment, logging

### Pitfalls

**Top 5 critical risks:**

| # | Pitfall | Mitigation |
|---|---------|------------|
| 1 | **Payment-registration atomicity** — payment clears but registration fails | State machine: pending → paid → registered → live. Retry with backoff. Manual intervention for stuck transactions. |
| 2 | **SQLite on ephemeral filesystem** — data loss on deploy | MUST use persistent volumes on Railway/Fly.io. WAL mode. Automated backups to S3. |
| 3 | **Namecheap sandbox != production** — untested differences | Canary production registration before launch. Don't trust sandbox for DNS/WHOIS behavior. |
| 4 | **DNS propagation gap** — users expect instant domains | Return 202 with status URL. Poll endpoint. Clear messaging: "2-5 minutes." |
| 5 | **x402 payment replay** — same proof used for multiple domains | Nonce-based idempotency. Store payment tx hash, reject duplicates. |

## Consensus Across Research

All dimensions agree on:
- **Hono is the right framework** — lightweight, ESM-native, sufficient middleware
- **SQLite is appropriate for v1** — simple deployment, sufficient scale, upgrade path to Postgres
- **Abstract registrar interface is essential** — don't couple to Namecheap
- **HTTP 301 redirects for URL forwarding** — simplest approach for v1
- **Agent-first design** — synchronous where possible, predictable errors, no interactive flows
- **Payment atomicity is the #1 risk** — requires careful state management

## Critical Unknowns

**Must verify before implementation:**

1. **@openfacilitator/sdk API** (BLOCKING)
   - Exact middleware function signatures
   - How payment proofs are passed (headers? body?)
   - Payment verification flow and error handling
   - Does it handle replay protection?

2. **Namecheap Reseller API** (BLOCKING for registrar phase)
   - Current API endpoints and XML response schemas
   - URL forwarding configuration specifics
   - Rate limits for reseller accounts
   - Sandbox vs production credential differences

3. **Package versions** (verify before install)
   - All versions from Jan 2025 training data — run `npm view` to confirm

## Roadmap Implications

**Suggested phase structure (5 phases):**

| Phase | Name | Focus | Dependencies |
|-------|------|-------|-------------|
| 1 | Foundation | Config, database, error handling, project setup | None |
| 2 | Integrations | Registrar interface + mock, x402 middleware | Phase 1 |
| 3 | Core API | Domain service, route handlers, registration flow | Phase 2 |
| 4 | URL Forwarding | Redirect server, DNS configuration | Phase 3 |
| 5 | Production | Deployment configs, backup strategy, hardening | Phase 4 |

**Critical path:** Phase 2 has two blockers — @openfacilitator/sdk documentation and Namecheap sandbox access. Should start verifying both during Phase 1.

## Requirements Implications

**Research suggests adding to v1 scope:**
- Idempotency on all write endpoints (payment ID as key)
- Transaction state tracking (pending → paid → registered → live)
- DNS propagation status polling endpoint
- Rate limiting (per-IP and per-wallet)
- Input validation (domain format, TLD whitelist, URL format)

**Research suggests removing/deferring:**
- Claim/transfer flow → v1.1 (confirmed by user)
- x402jobs integration → v1.1+ (confirmed by user)
- Path preservation on redirects → too complex for v1
- Multiple TLD support initially → start with common TLDs (.com, .net, .org, .io, .xyz, .dev)

---
*Synthesized from 4 research dimensions on 2026-02-03*
