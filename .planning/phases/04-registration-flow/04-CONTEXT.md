# Phase 4: Registration Flow - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Agents can register an available domain by paying USDC via x402. The registration endpoint accepts a domain name (and optional target URL), processes payment, submits to Namecheap, and tracks state transitions via the LRO pattern. Idempotent on payment ID. Failed registrations after payment are retried automatically. URL forwarding setup and renewal are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Registration endpoint design
- Multi-step flow: agent calls GET /domains/check first, then POST to register
- Check step is informational only — no quote token, register re-validates independently
- Request body: domain name required, target URL optional (can be set later via Phase 5)
- x402 payment proof in HTTP header (handled by middleware)
- Success response: full domain record (domain, status, owner wallet, target URL, dates, payment info)

### Payment-to-registration lifecycle (LRO pattern)
- Follows x402.jobs LRO pattern: https://www.x402.jobs/docs/long-running-resources
- Initial response: 202 Accepted with jobId, statusUrl, retryAfterSeconds
- Status polling states: processing / succeeded / failed (standard LRO)
- Step-based progress: payment_verified (33%) → registrar_submitted (66%) → registered (100%)
- Job status URLs never expire — agents can always check their registration status
- Payment settles before registrar call (simpler flow; manual resolution handles edge cases)

### Failure & retry behavior
- Auto-retry with exponential backoff on Namecheap failure (agent sees "processing" during retries)
- After all retries exhausted: status becomes "failed" with manual resolution flag
- Failed registrations after payment: flagged for admin review (manual resolution, not auto-refund)
- Race condition (domain taken between check and register): fail with specific error code (e.g., domain_unavailable)
- Idempotent: same payment ID returns same result, no duplicate charges

### Ownership & record model
- Payer = owner: wallet address from x402 payment proof is the domain owner (no separate owner field)
- One domain per registration request (no batch)
- Track registration expiry dates from Namecheap (useful even without renewal support)
- Domain record includes payment details: amount paid, payment ID, settlement timestamp

### Claude's Discretion
- Exact LRO state field naming (standard `state` vs additional `registrationDetail` sub-state)
- Number of retry attempts and backoff intervals
- Exact error codes and RFC 9457 problem detail types for registration failures
- retryAfterSeconds polling interval
- Internal job queue implementation

</decisions>

<specifics>
## Specific Ideas

- LRO pattern per x402.jobs spec: 202 Accepted → poll statusUrl → succeeded/failed
- "I want it to follow the x402.jobs LRO pattern" — explicit reference to https://www.x402.jobs/docs/long-running-resources
- Step-based progress gives agents visibility into where registration is in the pipeline

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-registration-flow*
*Context gathered: 2026-02-04*
