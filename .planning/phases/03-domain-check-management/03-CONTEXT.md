# Phase 3: Domain Check & Management - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

API endpoints for agents to check domain availability (with USDC pricing) and query domain status (owner, URL, registration state). Also provides a TLD listing endpoint. No registration or payment processing — that's Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Pricing model
- Pass-through pricing: registrar cost + 20% markup = USDC price
- 1 USD = 1 USDC (stablecoin assumption, no live rate oracle)
- Response shows total USDC price only (no breakdown of base + fee)

### Response design
- Availability check: returns available (bool), price (USDC, if available), domain name
- If unavailable, include alternative domain suggestions that ARE available
- Batch availability checks supported — up to 10 domains per request
- Domain status endpoint returns: domain, status (registered/available/pending), owner wallet, target URL, registered date, expiry date, last updated

### Domain validation
- Full validation in this phase (not deferred to Phase 6)
- Second-level domains only (name.tld) — no subdomains
- No reserved name list — let the registrar handle restrictions
- Input format: Claude's discretion (full domain vs separate name/tld params)

### Supported TLDs
- All TLDs that Namecheap offers — no curated subset
- TLD list stored as static config, refreshed periodically (not fetched live per request)
- TLD listing endpoint is free (no x402 payment required)
- Availability check endpoint is free (payment only at registration in Phase 4)

### Claude's Discretion
- API input format (full domain string vs name + tld params)
- How alternative suggestions are generated when domain is unavailable
- Static TLD config format and refresh mechanism
- Error response structure and machine-readable codes
- Exact validation rules (length limits, character restrictions)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-domain-check-management*
*Context gathered: 2026-02-03*
