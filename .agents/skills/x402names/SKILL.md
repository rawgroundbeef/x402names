---
name: x402names
description: Register domains, check domain availability, point domains at URLs, update domain DNS, and manage domain registrations via the x402names API. Use when the user wants to register a domain name, check if a domain is available, update where a domain points, verify DNS configuration, or interact with the x402names domain registration service. Triggers on phrases like "register a domain", "check domain availability", "point domain at URL", "update domain DNS", "buy a domain", "set up a domain".
---

# x402names

x402names is a domain registration API that accepts USDC payments via the x402 protocol. It provides endpoints for checking domain availability, registering domains, updating target URLs, and verifying DNS configuration. All paid operations use x402 payment headers instead of API keys.

## Prerequisites

- **Server URL**: The base URL of the running x402names instance (default `http://localhost:3000`)
- **x402 wallet with USDC**: Paid endpoints (register, URL update) require a valid x402 payment header with sufficient USDC on Base Sepolia (or configured network)
- **Domain knowledge**: Familiarity with DNS concepts (A records, propagation)

## Core Workflows

### 1. Check & Register a Domain

**Goal**: Find an available domain and register it.

```
Step 1: Get supported TLDs and pricing
  GET /tlds
  → Returns list of TLDs with USDC prices

Step 2: Check availability (batch up to 10)
  POST /domains/check
  Body: {"domains": ["example.com", "example.io"]}
  → Returns availability, pricing per domain, suggestions for taken domains

Step 3: Register (requires x402 payment)
  POST /domains/register
  Headers: Payment-Signature: <x402-payment>
  Body: {"domain": "example.com", "targetUrl": "https://mysite.com"}
  → Returns 402 if no/insufficient payment
  → Returns 202 with jobId on success

Step 4: Poll registration status
  GET /registrations/:jobId/status
  → state: "processing" (poll again after retryAfterSeconds)
  → state: "succeeded" (done, includes artifactUrl)
  → state: "failed" (includes error and code)
```

The register endpoint uses a Long-Running Operation (LRO) pattern. After getting a 202, poll the status URL until the job completes.

### 2. Update a Domain's Target URL

**Goal**: Change where a registered domain redirects to.

```
Step 1: Check current domain status
  GET /domains/:name/status
  → Confirms domain exists and shows current targetUrl

Step 2: Update URL (requires x402 payment of 2.00 USDC)
  PATCH /domains/:name/url
  Headers: Payment-Signature: <x402-payment>
  Body: {"targetUrl": "https://new-destination.com"}
  → Returns 402 if no/insufficient payment
  → Returns 403 if payer wallet doesn't match owner
  → Returns 200 with updated info on success
```

The payer wallet extracted from the payment header must match the domain's owner wallet.

### 3. Verify DNS Configuration

**Goal**: Check that DNS is properly configured for a domain.

```
Step 1: Get DNS configuration info
  GET /domains/:name/dns
  → Returns expected A records and setup instructions

Step 2: Verify DNS propagation
  GET /domains/:name/dns/verify
  → Returns verified: true/false with resolved IPs vs expected
```

DNS changes can take up to 48 hours to propagate globally.

### 4. Error Handling

**Discovery**: Fetch the full error catalog at `GET /errors` or a specific error at `GET /errors/:code`.

**Rate limits**: Free read endpoints are rate-limited to 100 requests/minute/IP. On 429, wait for `Retry-After` header value before retrying.

**Retryable errors**: `RATE_LIMIT_EXCEEDED`, `REGISTRAR_UNAVAILABLE`, `REGISTRAR_ERROR`, `REGISTRAR_AUTH_ERROR`, `SERVER_ERROR`. Use exponential backoff.

**Non-retryable errors**: Validation errors (400), payment errors (402/409), domain conflicts (409). Fix the request before retrying.

## Payment Header Format

x402 payments are passed via the `Payment-Signature` or `X-Payment` header. The payment contains:
- **from**: Payer wallet address (used for ownership verification)
- **value/amount**: Payment amount in token base units (1 USDC = 1,000,000 units)
- **network**: EVM chain identifier (default: `eip155:84532` for Base Sepolia)

Payment amounts are specified in USDC. Registration prices vary by TLD (check `GET /tlds`). URL updates cost a flat 2.00 USDC.

## All Errors Use RFC 9457 Problem Details

Every error response follows this shape:
```json
{
  "type": "error:<error_type>",
  "title": "Human-Readable Title",
  "status": 400,
  "detail": "Specific error description"
}
```

Validation errors include an `errors` array with `field`, `code`, and `message` per field.

## API Reference

For full endpoint documentation including all request/response shapes, error codes, and pricing details, see [references/api-reference.md](references/api-reference.md).
