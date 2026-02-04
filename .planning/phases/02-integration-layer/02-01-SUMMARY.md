---
phase: 02-integration-layer
plan: 01
subsystem: domain-registrar
tags: [namecheap, domain-api, registrar, xml-api, mock-testing]
requires:
  - 01-01 # TypeScript environment and project structure
  - 01-02 # Environment configuration with envalid
provides:
  - Abstract DomainRegistrar interface with 6 operations
  - Namecheap XML API adapter
  - Mock registrar for testing
  - Typed error hierarchy with instanceof support
affects:
  - 03-* # Domain business logic will depend on DomainRegistrar abstraction
tech-stack:
  added: []
  patterns:
    - Abstract class for interface with instanceof checking
    - Error hierarchy with Object.setPrototypeOf for proper prototype chains
    - Regex-based XML parsing (no external XML parser)
    - Mock implementation for fast isolated testing
key-files:
  created:
    - apps/api/src/integrations/registrar/types.ts
    - apps/api/src/integrations/registrar/namecheap.ts
    - apps/api/src/integrations/registrar/mock.ts
    - apps/api/src/integrations/registrar/__tests__/registrar.test.ts
  modified:
    - apps/api/src/config/env.ts # Added Namecheap credentials (already committed in previous phase)
key-decisions:
  - decision: Use abstract class instead of interface for DomainRegistrar
    rationale: Interfaces disappear at runtime; abstract class enables instanceof checks and runtime type identification
    context: Task 1
  - decision: Parse Namecheap XML responses with regex instead of XML parser
    rationale: Keeps dependencies minimal, responses are simple enough for regex, no need for full XML DOM
    context: Task 2
  - decision: Use exec() loop instead of matchAll() for regex iteration
    rationale: matchAll requires ES2020 target; exec loop provides broader TypeScript compatibility
    context: Task 2
  - decision: Mock uses "taken-" prefix convention for unavailable domains
    rationale: Simple, deterministic testing without external state; easy to create test fixtures
    context: Task 2
patterns-established:
  - External service abstraction with abstract class and multiple implementations
  - Typed error hierarchy for domain-specific error handling
  - Mock-first testing approach for external API integrations
duration: 4 minutes 10 seconds
completed: 2026-02-04
---

# Phase 02 Plan 01: Registrar Interface & Implementations Summary

**One-liner:** Abstract DomainRegistrar with Namecheap XML adapter and mock implementation for testing

## Overview

This plan establishes the registrar abstraction layer that decouples business logic from specific domain registrar APIs. It provides three core components:

1. **Abstract interface** defining 6 domain operations (check, price, register, status, DNS get/set)
2. **Namecheap adapter** translating between the abstract interface and Namecheap's XML API
3. **Mock registrar** returning realistic hardcoded data for fast, isolated testing

All business logic in Phase 3+ will depend on the abstract DomainRegistrar interface, never on concrete implementations. This enables swapping registrars without touching business logic.

## What Was Built

### Abstract Interface (types.ts)
- `DomainRegistrar` abstract class with 6 methods:
  - `checkAvailability(domain)` → availability + premium status
  - `getPrice(domain)` → registration and renewal pricing
  - `register(domain, years, contact)` → registration result with transaction ID
  - `getStatus(domain)` → domain status, expiration, nameservers
  - `setDnsRecords(domain, records)` → configure DNS
  - `getDnsRecords(domain)` → fetch current DNS configuration

- Six typed data structures: DomainAvailability, DomainPrice, ContactInfo, RegistrationResult, DomainStatus, DnsRecord

- Error hierarchy with proper prototype chains:
  - `RegistrarError` (base)
  - `RegistrarUnavailable` (API down, network error)
  - `DomainTaken` (domain already registered)
  - `InvalidTLD` (unsupported TLD)
  - `RegistrarAuthError` (authentication failure)
  - `RegistrarRateLimitError` (rate limit exceeded)

Each error class calls `Object.setPrototypeOf(this, ClassName.prototype)` to enable instanceof checking after transpilation.

### Namecheap Adapter (namecheap.ts)
- `NamecheapRegistrar extends DomainRegistrar`
- Constructor accepts: apiUser, apiKey, clientIp, sandbox (boolean)
- Private helper `callApi(command, params)`:
  - Builds authenticated request to Namecheap XML API
  - Handles sandbox vs production URLs
  - Throws RegistrarUnavailable on network errors or non-200 status
- Private helper `parseXmlErrors(xml)`:
  - Extracts error code and message from XML response
  - Maps Namecheap error codes to typed exceptions:
    - 2030280 → DomainTaken
    - 1011150 → RegistrarAuthError
    - 500000+ → RegistrarRateLimitError
- All 6 abstract methods implemented with regex XML parsing
- Uses `exec()` loops instead of `matchAll()` for broader TypeScript compatibility

### Mock Registrar (mock.ts)
- `MockRegistrar extends DomainRegistrar`
- Domains starting with "taken-" → unavailable
- Realistic TLD pricing: .com=$10.98, .net=$13.98, .org=$14.98, .io=$39.98
- Registration returns success with `MOCK-{timestamp}-{random}` transaction ID
- Tracks registered domains in memory for future availability checks
- Status returns active for registered domains, unknown otherwise
- DNS records stored in Map for get/set operations

### Test Coverage (registrar.test.ts)
- 25 tests, all passing:
  - Error hierarchy: instanceof chains, name properties, descriptive messages
  - MockRegistrar conformance: all 6 methods callable and return correct types
  - Domain availability: taken- prefix detection, normal domains available
  - TLD pricing: .com, .net, .org, .io correctly priced
  - Registration flow: domains become unavailable after registration
  - Status checking: active for registered, unknown for unregistered
  - DNS management: set/get persistence
  - Type safety: MockRegistrar assignable to DomainRegistrar variable

## Commits

**Task 1: Abstract interface and error hierarchy**
```
be47c78 - feat(02-01): abstract registrar interface and error hierarchy
```
- DomainRegistrar abstract class with 6 methods
- Type definitions for all registrar data structures
- Error hierarchy with proper prototype chains

**Task 2: Implementations**
```
2e150cf - feat(02-01): Namecheap adapter and mock registrar
```
- NamecheapRegistrar with XML API integration
- MockRegistrar for testing
- Compatible regex parsing (exec loop, not matchAll)

**Task 3: Tests**
```
7c5f0ec - test(02-01): registrar interface and mock tests
```
- 25 tests covering error hierarchy, mock conformance, type safety

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed matchAll compatibility issue**
- **Found during:** Task 2 verification
- **Issue:** TypeScript compilation failed with error "Type 'RegExpStringIterator' can only be iterated through when using the '--downlevelIteration' flag or with a '--target' of 'es2015' or higher"
- **Fix:** Replaced `matchAll()` with `exec()` loop pattern for regex iteration
- **Files modified:** apps/api/src/integrations/registrar/namecheap.ts (two occurrences)
- **Commit:** 2e150cf (included in Task 2 commit)
- **Rationale:** exec() provides the same functionality with broader compatibility, no downside

**2. [Observed] env.ts already had Namecheap variables**
- **Found during:** Task 2 commit preparation
- **Issue:** env.ts modifications were already committed (from a previous phase or external change)
- **Action:** Verified variables were present with correct types (bool, num imported)
- **Impact:** None - variables were already correctly configured
- **Commit:** No additional commit needed

## Next Phase Readiness

### Ready for Phase 3
- ✅ Abstract DomainRegistrar interface available for business logic
- ✅ MockRegistrar enables fast testing without external API calls
- ✅ Error types support proper error handling and instanceof checks

### Blockers
None. However, **Namecheap API credentials are required** before production deployment:
- NAMECHEAP_API_USER
- NAMECHEAP_API_KEY
- NAMECHEAP_CLIENT_IP (production server IP)

Current defaults:
- NAMECHEAP_API_USER: '' (empty)
- NAMECHEAP_API_KEY: '' (empty)
- NAMECHEAP_CLIENT_IP: '127.0.0.1' (localhost)
- NAMECHEAP_SANDBOX: true (sandbox mode)

These are OK for development with MockRegistrar but must be configured before using NamecheapRegistrar in production.

### Integration Points
Phase 3 business logic should:
1. Import `DomainRegistrar` from `integrations/registrar/types`
2. Accept `DomainRegistrar` as constructor parameter (dependency injection)
3. Never import `NamecheapRegistrar` or `MockRegistrar` directly
4. Catch typed errors (DomainTaken, RegistrarUnavailable, etc.) for user-facing error messages

Example:
```typescript
class DomainService {
  constructor(private registrar: DomainRegistrar) {}

  async checkDomain(name: string) {
    try {
      return await this.registrar.checkAvailability(name);
    } catch (error) {
      if (error instanceof DomainTaken) {
        // Handle taken domain
      } else if (error instanceof RegistrarUnavailable) {
        // Handle API unavailable
      }
      throw error;
    }
  }
}
```

## Lessons Learned

1. **Abstract classes > interfaces for runtime checking:** Using abstract class instead of interface enables instanceof checks and runtime type identification, which is critical for dependency injection and error handling.

2. **matchAll() requires modern target:** When using regex iteration, prefer `exec()` loop over `matchAll()` for broader TypeScript target compatibility. The pattern is slightly more verbose but works everywhere.

3. **Mock-first reduces external dependencies:** Building MockRegistrar first enabled full test coverage without Namecheap credentials. This accelerates development and enables CI/CD without API secrets.

4. **Error prototype chains require explicit setup:** TypeScript/JavaScript transpilation breaks instanceof for custom errors. Every error class must call `Object.setPrototypeOf(this, ClassName.prototype)` to restore proper prototype chain.

5. **Regex XML parsing is sufficient for simple APIs:** Namecheap's XML responses are simple enough that regex extraction is faster and lighter than a full XML parser. This keeps the dependency tree minimal.

## Performance Notes

- MockRegistrar operations: <1ms (in-memory)
- NamecheapRegistrar operations: Not yet benchmarked (requires API credentials)
- Test suite: 84 expect() calls in 29ms (all registrar tests)

## Future Enhancements

**Not in scope for this phase, but worth noting:**

1. **Registrar failover:** Implement fallback logic to try alternate registrars if primary is unavailable
2. **Caching layer:** Cache domain availability and pricing to reduce API calls
3. **Bulk operations:** Add methods for batch domain checks (Namecheap supports this)
4. **Webhook support:** Listen for domain registration status updates
5. **Additional registrars:** Add adapters for Cloudflare, GoDaddy, etc.

These should be considered in later phases based on actual usage patterns.
