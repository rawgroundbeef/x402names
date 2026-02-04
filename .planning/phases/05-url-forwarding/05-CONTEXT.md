# Phase 5: URL Forwarding - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Registered domains redirect visitors to target URLs. Redirect server handles multi-domain routing, DNS is auto-configured via Namecheap API, and domain owners can update target URLs by paying a flat fee. SSL provisioning for registered domains included.

</domain>

<decisions>
## Implementation Decisions

### Redirect behavior
- 301 Permanent redirects for all domain forwarding
- Forward full paths: domain.com/about → target.com/about
- Forward query strings and fragments: domain.com?ref=abc → target.com?ref=abc
- Domains with no target URL set show a simple holding page ("This domain is registered but not configured yet")

### URL update pricing
- Flat fee of $2.00 USDC per URL update, regardless of TLD
- Same wallet that registered the domain must pay for updates (ownership verification via payment header wallet address)
- URL updates are synchronous — update database immediately, return success (no job queue)
- Idempotent: same update request returns same result

### DNS configuration
- Fully automatic DNS setup via Namecheap API during registration — zero manual steps
- API endpoint (GET /domains/:name/dns) returns DNS record instructions for a domain
- DNS verification endpoint (GET /domains/:name/dns/verify) confirms records are properly configured and propagated
- DNS approach: Claude's Discretion — pick simplest method that requires no human intervention

### Multi-domain serving
- Unknown domains (not registered in system) show a generic landing page: "This domain is available for registration" with link to API
- Auto SSL via Let's Encrypt for each registered domain
- In-memory cache for domain-to-URL mappings with TTL (slight delay on URL update propagation, fast redirect performance)

### Claude's Discretion
- Redirect server architecture (same app vs separate service, port strategy, host-based routing)
- DNS method choice (A-record, CNAME, nameservers) — constraint: simplest with no human intervention
- Cache TTL duration
- Holding page and landing page HTML design
- SSL certificate provisioning implementation details

</decisions>

<specifics>
## Specific Ideas

- Agent experience is paramount — DNS should "just work" after registration with no manual steps
- The redirect server needs to handle both registered-but-unconfigured domains (holding page) and completely unknown domains (landing page with registration CTA)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-url-forwarding*
*Context gathered: 2026-02-04*
