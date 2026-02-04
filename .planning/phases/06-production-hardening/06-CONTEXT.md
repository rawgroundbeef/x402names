# Phase 6: Production Hardening - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the API production-ready with rate limiting, input validation, and error documentation. All API endpoints already exist and are functional. RFC 9457 error framework already in place from Phase 3. This phase hardens what's built — no new endpoints or capabilities.

</domain>

<decisions>
## Implementation Decisions

### Rate limiting strategy
- Generous limits: 100+ requests/min for read endpoints (availability checks, status, TLD listing)
- Paid/write endpoints do NOT need rate limiting — payment is the natural throttle
- Per-IP only (no per-wallet bucketing)
- 429 response includes Retry-After header with wait time in seconds
- No X-RateLimit-Remaining or proactive quota headers needed

### Input validation rules
- Domain names: standard DNS rules (letters, numbers, hyphens, no leading/trailing hyphens, max 63 chars per label, 253 total)
- DNS limits only for length — no additional minimum/maximum restrictions
- No brand/trademark filtering — registrar handles disputes, we pass through
- Target URL validation: moderate filtering — valid URL, http/https only, reject localhost/private IPs, reject URLs with embedded auth credentials, reject excessively long URLs, reject known malicious patterns

### Error response design
- Minimal detail: error code + generic message, no fix suggestions or internal details
- Namespaced error codes (e.g., RATE_LIMIT_EXCEEDED, DOMAIN_INVALID_FORMAT, URL_SCHEME_UNSUPPORTED)
- Validation errors return ALL problems at once (not fail-on-first)
- Internal errors (database, registrar API) surface as generic SERVER_ERROR — don't leak internals
- Build on existing RFC 9457 problem details framework from Phase 3

### Documentation scope
- Document all four error categories with example responses: payment errors, validation errors, rate limiting, registration failures
- Agent-first format: structured for machine consumption, consistent format, parseable error catalog, minimal prose
- Will eventually be wrapped into an agent skill with more verbose context

### Claude's Discretion
- Error catalog format choice (standalone file vs inline)
- Whether to include happy-path examples alongside error examples
- Rate limit window implementation (sliding window vs fixed window)
- Specific rate limit numbers within the "generous" guidance
- URL validation pattern details (what counts as "malicious pattern")

</decisions>

<specifics>
## Specific Ideas

- "The documentation will be for agents mostly and then turned into an agent skill" — format should be machine-parseable first
- Paid endpoints are self-limiting by design — focus hardening effort on free read endpoints

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-production-hardening*
*Context gathered: 2026-02-04*
