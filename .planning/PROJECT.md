# x402names

## What This Is

x402names is a domain registration service powered by x402 micropayments. Agents and users pay USDC to register domain names and point them at any URL — IPFS content, x402.storage URLs, or arbitrary web addresses. No credit cards, no accounts, no humans required.

## Core Value

An agent can register a domain and point it at content with a single API call and a USDC payment. Zero human intervention from payment to live domain.

## Current Milestone: v1.0 — Domain Registration Service

**Goal:** Ship a working API where agents pay USDC to register domains and point them at URLs.

**Target features:**
- Domain availability check with dynamic pricing
- Domain registration via x402 payment
- DNS/URL mapping configuration
- Domain status lookup
- DNS update for owned domains

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Agent can check domain availability and price
- [ ] Agent can register a domain by paying USDC via x402
- [ ] Registered domain points at any user-specified URL
- [ ] Agent can update where a domain points (small fee)
- [ ] Agent can check registration status and DNS for any domain
- [ ] Abstract registrar interface with Namecheap as first implementation

### Out of Scope

- Domain claim/transfer flow — deferred to v1.1 when core registration is proven
- x402jobs integration — get core API working first (v1.1+)
- Auto-renewal — manual for v1, revisit based on usage patterns
- Email forwarding — not core to the agent-registers-domain story
- Subdomain management — complexity vs value tradeoff, defer
- Premium domain pricing — standard pricing sufficient for v1
- Non-IPFS-specific DNS (MX, etc.) — URL pointing covers the core use case
- Mobile/web UI — API-first, agents are the primary consumer

## Context

- Part of the x402 autonomous agent web stack: x402.storage (content) + x402names (domains)
- Primary consumers are AI agents, not humans — API must be dead simple
- Uses `@openfacilitator/sdk` for x402 payment verification
- Domains registered under x402names' reseller account (custodial model)
- Ownership tracked internally by wallet address that paid
- Domains can point at any URL (not limited to IPFS gateways)
- Pricing pulled dynamically from registrar API with service margin added

## Constraints

- **Tech stack**: Node.js ESM, Hono framework, SQLite via better-sqlite3
- **Payment**: x402 protocol via @openfacilitator/sdk — USDC only
- **Registrar**: Abstract interface, Namecheap reseller API as first implementation
- **Deployment**: Must support Railway, Fly.io, and self-hosting
- **DNS propagation**: Inherent delay (~2-5 min) — not a bug, document it

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hono over Express | Lightweight, modern, works everywhere | — Pending |
| SQLite over Postgres | Simple for v1, can swap via adapter later | — Pending |
| Abstract registrar interface | Swap providers without rewriting business logic | — Pending |
| Any-URL mapping (not IPFS-only) | Broader utility — agents point domains at any content | — Pending |
| Custodial domain model | Simplest v1 — domains under our reseller account, tracked by wallet | — Pending |
| @openfacilitator/sdk for x402 | Existing SDK for payment verification | — Pending |

---
*Last updated: 2026-02-03 after project initialization*
