# x402names API Reference

## Table of Contents

- [Health](#health)
- [TLDs](#tlds)
- [Domain Check](#domain-check)
- [Domain Register](#domain-register)
- [Registration Status](#registration-status)
- [Domain Status](#domain-status)
- [Domain DNS](#domain-dns)
- [Domain DNS Verify](#domain-dns-verify)
- [Domain URL Update](#domain-url-update)
- [Error Catalog](#error-catalog)
- [Redirect Server](#redirect-server)
- [Pricing Model](#pricing-model)
- [Error Code Catalog](#error-code-catalog)
- [Payment Details](#payment-details)

---

## Health

### GET /health

Health check endpoint. No auth required.

**Response 200**:
```json
{
  "status": "ok",
  "timestamp": "2026-02-04T00:00:00.000Z",
  "env": "development",
  "database": "ok"
}
```

`status` is `"ok"` or `"degraded"` (when database is unreachable).

---

## TLDs

### GET /tlds

List all supported TLDs with USDC pricing (markup already applied). No auth required.

**Response 200**:
```json
{
  "tlds": [
    {
      "tld": "com",
      "registrationPrice": 13.18,
      "renewalPrice": 15.58,
      "currency": "USDC"
    }
  ],
  "count": 30,
  "lastUpdated": "2026-02-04T00:00:00Z"
}
```

### GET /tlds/:tld

Get pricing for a specific TLD. No auth required.

**Response 200**:
```json
{
  "tld": "com",
  "registrationPrice": 13.18,
  "renewalPrice": 15.58,
  "currency": "USDC"
}
```

**Response 404**: TLD not found.

---

## Domain Check

### POST /domains/check

Batch availability check for 1-10 domains. No auth required.

**Request body**:
```json
{
  "domains": ["example.com", "taken-example.com"]
}
```

**Response 200**:
```json
{
  "results": [
    {
      "domain": "example.com",
      "available": true,
      "price": {
        "registration": 13.18,
        "renewal": 15.58,
        "currency": "USDC"
      }
    },
    {
      "domain": "taken-example.com",
      "available": false,
      "suggestions": ["taken-example.net", "taken-example.io"]
    }
  ]
}
```

Results per domain may include:
- `available: true` + `price` — domain available with USDC pricing
- `available: true` + `price: null` + `error` — premium domain, contact for pricing
- `available: false` + `suggestions` — domain taken, alternatives suggested
- `available: false` + `error` — validation or registrar error

---

## Domain Register

### POST /domains/register

Register a domain. **Requires x402 payment.**

**Headers**:
- `Payment-Signature` or `X-Payment`: x402 payment signature (required)
- `X-Payment-Network`: Payment network identifier (optional)

**Request body**:
```json
{
  "domain": "example.com",
  "targetUrl": "https://mysite.com"
}
```

`targetUrl` is optional. If provided, the domain will redirect to this URL after registration.

**Response 202** (success — job created):
```json
{
  "jobId": "uuid-here",
  "statusUrl": "/registrations/uuid-here/status",
  "retryAfterSeconds": 2,
  "message": "Registration initiated - payment verified"
}
```

**Response 402**: No payment header or insufficient payment amount.
**Response 400**: Invalid domain, unsupported TLD, invalid payment, premium domain.
**Response 409**: Domain unavailable or payment already used.

**Idempotency**: If the same payment header is sent again, returns the existing job ID with 202.

---

## Registration Status

### GET /registrations/:jobId/status

Poll registration job status (LRO pattern). No auth required.

**Response 200 — processing**:
```json
{
  "state": "processing",
  "progress": 50,
  "currentStep": "registering_domain",
  "retryAfterSeconds": 2
}
```

**Response 200 — succeeded**:
```json
{
  "state": "succeeded",
  "artifactUrl": "/domains/example.com/status",
  "domain": "example.com",
  "ownerWallet": "0x...",
  "response": "Domain example.com registered successfully"
}
```

**Response 200 — failed**:
```json
{
  "state": "failed",
  "error": "Registration failed",
  "code": "unknown_error",
  "domain": "example.com"
}
```

**Response 404**: Job ID not found.

---

## Domain Status

### GET /domains/:domain/status

Get registration status for a domain. No auth required.

`:domain` is the full domain name (e.g., `example.com`).

**Response 200**:
```json
{
  "domain": "example.com",
  "status": "registered",
  "ownerWallet": "0x...",
  "targetUrl": "https://mysite.com",
  "registeredAt": "2026-02-04T00:00:00.000Z",
  "expiresAt": "2027-02-04T00:00:00.000Z",
  "lastUpdated": "2026-02-04T00:00:00.000Z"
}
```

Status values:
- `available` — not registered anywhere
- `pending` — registration in progress
- `paid` — payment received, processing
- `registered` — registered (possibly elsewhere, not through x402names)
- `live` — registered and configured with target URL
- `failed` — registration failed

If the domain is not in the local database, the registrar is queried. If the registrar returns `active`, status is `registered` with null wallet/URL.

---

## Domain DNS

### GET /domains/:domain/dns

Get DNS configuration info for a registered domain. No auth required.

`:domain` is the domain name as stored in the system.

**Response 200**:
```json
{
  "domain": "example",
  "serverIp": "127.0.0.1",
  "records": [
    {"type": "A", "host": "@", "value": "127.0.0.1", "ttl": 300},
    {"type": "A", "host": "www", "value": "127.0.0.1", "ttl": 300}
  ],
  "instructions": [
    "Configure DNS A record for '@' (root domain) pointing to 127.0.0.1",
    "Configure DNS A record for 'www' subdomain pointing to 127.0.0.1",
    "DNS changes may take up to 48 hours to propagate globally",
    "Use the /dns/verify endpoint to check propagation status"
  ],
  "domainStatus": "registered"
}
```

**Response 404**: Domain not found in system.

---

## Domain DNS Verify

### GET /domains/:domain/dns/verify

Verify DNS propagation. No auth required.

**Response 200**:
```json
{
  "domain": "example",
  "verified": true,
  "resolvedIps": ["1.2.3.4"],
  "expectedIp": "1.2.3.4",
  "message": "DNS is correctly configured. example resolves to 1.2.3.4"
}
```

`verified` is `true` when at least one resolved IP matches the expected redirect server IP. If DNS resolution fails entirely, `resolvedIps` will be empty.

**Response 404**: Domain not found in system.

---

## Domain URL Update

### PATCH /domains/:domain/url

Update a domain's target URL. **Requires x402 payment of 2.00 USDC.**

**Headers**:
- `Payment-Signature` or `X-Payment`: x402 payment signature (required)

**Request body**:
```json
{
  "targetUrl": "https://new-destination.com"
}
```

**Response 200** (updated):
```json
{
  "success": true,
  "updated": true,
  "domain": "example",
  "targetUrl": "https://new-destination.com",
  "previousUrl": "https://old-site.com"
}
```

**Response 200** (already set):
```json
{
  "success": true,
  "updated": false,
  "reason": "url_already_set",
  "domain": "example",
  "targetUrl": "https://new-destination.com"
}
```

**Response 402**: No payment or insufficient amount (< 2.00 USDC).
**Response 403**: Payer wallet does not match domain owner.
**Response 404**: Domain not found.
**Response 409**: Payment already used.

---

## Error Catalog

### GET /errors

Returns the full error catalog for agent discovery. No auth required.

**Response 200**: JSON object with `version`, `generated`, `categories`, and `errors` array.

### GET /errors/:code

Returns a single error entry by code (case-insensitive). No auth required.

**Response 200**: Single error object with `code`, `type`, `status`, `title`, `description`, `category`, `retryable`, `example`.

**Response 404**: Error code not found.

---

## Redirect Server

Runs on a separate port (default 3001). Routes requests by `Host` header to the appropriate domain's target URL.

- **Domain with targetUrl**: 301 redirect preserving path and query string
- **Domain registered but no URL**: Landing page showing "Domain Registered" with configuration prompt
- **Domain not registered**: Landing page showing "Domain Available" with registration prompt
- **ACME challenges**: `/.well-known/acme-challenge/` returns 404 (placeholder for future SSL)

---

## Pricing Model

Prices are base cost from the registrar (Namecheap) with a configurable markup (default 20%) applied. All prices are in USDC.

| Operation | Price |
|-----------|-------|
| Domain registration | Varies by TLD (see `GET /tlds`) |
| URL update | Flat 2.00 USDC |

Example TLD prices (with 20% markup):
- `.com`: ~$13.18 registration, ~$15.58 renewal
- `.io`: ~$47.98 registration, ~$47.98 renewal
- `.ai`: ~$119.98 registration, ~$119.98 renewal
- `.xyz`: ~$3.58 registration, ~$15.58 renewal

---

## Error Code Catalog

26 error codes organized by category:

### Rate Limiting
| Code | Status | Retryable |
|------|--------|-----------|
| `RATE_LIMIT_EXCEEDED` | 429 | Yes |

### Validation
| Code | Status | Retryable |
|------|--------|-----------|
| `VALIDATION_ERROR` | 400 | No |
| `DOMAIN_INVALID_FORMAT` | 400 | No |
| `URL_INVALID_FORMAT` | 400 | No |
| `URL_SCHEME_UNSUPPORTED` | 400 | No |
| `URL_LOCALHOST_REJECTED` | 400 | No |
| `URL_PRIVATE_ADDRESS` | 400 | No |
| `URL_CREDENTIALS_REJECTED` | 400 | No |
| `URL_TOO_LONG` | 400 | No |

### Payment
| Code | Status | Retryable |
|------|--------|-----------|
| `PAYMENT_REQUIRED` | 402 | Yes |
| `INSUFFICIENT_PAYMENT` | 402 | Yes |
| `INVALID_PAYMENT` | 400 | No |
| `PAYMENT_ALREADY_USED` | 409 | No |

### Registration
| Code | Status | Retryable |
|------|--------|-----------|
| `DOMAIN_UNSUPPORTED_TLD` | 400 | No |
| `DOMAIN_UNAVAILABLE` | 409 | No |
| `DOMAIN_NOT_FOUND` | 404 | No |
| `NOT_DOMAIN_OWNER` | 403 | No |
| `PREMIUM_DOMAIN` | 400 | No |
| `PRICING_NOT_AVAILABLE` | 400 | No |
| `TLD_NOT_FOUND` | 404 | No |
| `JOB_NOT_FOUND` | 404 | No |
| `INVALID_JOB_STATE` | 500 | No |

### Server
| Code | Status | Retryable |
|------|--------|-----------|
| `SERVER_ERROR` | 500 | Yes |
| `REGISTRAR_UNAVAILABLE` | 503 | Yes |
| `REGISTRAR_ERROR` | 502 | Yes |
| `REGISTRAR_AUTH_ERROR` | 503 | Yes |

All errors follow RFC 9457 Problem Details format:
```json
{
  "type": "error:<type>",
  "title": "Human-Readable Title",
  "status": 400,
  "detail": "Specific description"
}
```

---

## Payment Details

### Header Names
- Primary: `Payment-Signature`
- Fallback: `X-Payment`
- Optional: `X-Payment-Network` (for recording purposes)

### Amount Encoding
Payment amounts in the x402 header are in **token base units**:
- 1 USDC = 1,000,000 base units
- To pay 13.18 USDC, the header value field should contain `13180000`

### Making Payments with @x402/fetch

The easiest way to make paid requests is with `@x402/fetch`, which handles the 402 handshake automatically:

```typescript
import { wrapFetch } from "@x402/fetch";
import { createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount("0xYOUR_PRIVATE_KEY");
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(),
});

const fetchWithPayment = wrapFetch(fetch, walletClient);

// Register — @x402/fetch handles the 402 → pay → retry cycle
const res = await fetchWithPayment("https://x402names.example/domains/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ domain: "coolproject.com", targetUrl: "https://mysite.com" }),
});

// Update URL
const updateRes = await fetchWithPayment("https://x402names.example/domains/coolproject.com/url", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ targetUrl: "https://new-site.com" }),
});
```

### Payment Flow (under the hood)
1. Client sends request without payment header
2. Server responds with 402 including required amount
3. `@x402/fetch` constructs payment with the required USDC amount
4. Payment header includes payer wallet address (`from` field)
5. `@x402/fetch` retries the request with the payment header
6. Server decodes header, extracts wallet and amount
7. Server verifies amount >= required price
8. Payment ID (SHA-256 of header) is recorded for replay protection
9. Same payment header on retry returns the existing job (idempotent)

### Payment Failure Handling
If registration fails after payment is accepted (e.g., registrar outage):
- The job retries up to 3 times with exponential backoff
- Job moves to `state: "failed"` only after all retries are exhausted
- The payment is recorded but not consumed for a successful registration
- Replaying the same request (same payment header) returns the existing job — safe to retry
- For failed jobs where payment was taken, contact the operator for resolution

### Wallet Ownership
For URL updates, the payer wallet from the payment header must match the domain's `ownerWallet` (case-insensitive comparison). This prevents unauthorized modifications.
