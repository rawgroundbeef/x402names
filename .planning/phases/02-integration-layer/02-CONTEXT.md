# Phase 2: Integration Layer - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

External integrations ready for business logic to consume. Abstract registrar interface (Namecheap as first implementation) and x402 payment middleware (@openfacilitator/sdk). Mock registrar for testing. Replay protection for duplicate payments. No business logic, no API endpoints — just the integration plumbing.

</domain>

<decisions>
## Implementation Decisions

### Registrar interface design
- Abstract interface exposes: checkAvailability, getPrice, register, getStatus, setDnsRecords, getDnsRecords
- DNS management included in the interface (needed for URL forwarding in Phase 5)
- Namecheap is the first concrete implementation
- Typed error classes for registrar failures (RegistrarUnavailable, DomainTaken, InvalidTLD, etc.) — callers match on type
- Registrar returns raw USD pricing; since USDC = USD (1:1 peg), the price is the same value in USDC
- Percentage markup applied on top of registrar base price (configurable, e.g., 20%)

### Mock registrar behavior
- Simple stubs — always returns success with hardcoded data
- Used in tests only — local dev does not use the mock
- Returns realistic Namecheap-like pricing (e.g., .com = $10.98, not round numbers)
- Error simulation: Claude's discretion on whether to add configurable error triggers

### x402 payment verification
- Use @openfacilitator/sdk Hono middleware directly — SDK handles the protocol
- Standard x402 402 response format (SDK handles this automatically)
- Accept USDC on Base and Solana networks
- Testing uses testnet tokens (Base Sepolia + Solana devnet) — real protocol, fake money

### Replay protection
- Store used payment IDs in SQLite table (persistent, survives restarts)
- Duplicate payment ID returns HTTP 409 Conflict
- Payment records kept forever — permanent replay protection + audit log
- Full audit trail per payment: payment ID, wallet address, amount, timestamp, associated domain, network

### Claude's Discretion
- Mock registrar error simulation approach (configurable triggers vs always-succeed)
- Exact percentage markup value for MVP (configurable via env/config)
- Internal structure of the registrar interface module (file layout, dependency injection pattern)
- Facilitator SDK configuration details

</decisions>

<specifics>
## Specific Ideas

- @openfacilitator/sdk provides the Hono middleware — don't reinvent the x402 protocol handling
- USDC = USD at 1:1 peg, so no currency conversion logic needed
- Payment audit trail doubles as the replay protection mechanism (same table)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-integration-layer*
*Context gathered: 2026-02-03*
