import { parse } from 'tldts';
import { z } from 'zod';

/**
 * Domain validation result
 */
export interface DomainValidationResult {
  valid: boolean;
  domain?: string;
  sld?: string;
  tld?: string;
  error?: string;
}

/**
 * Validate a domain name according to RFC 1035 and common registrar rules
 *
 * Rules:
 * - Second-level domains only (no subdomains)
 * - Label length <= 63 characters
 * - Total domain length <= 253 characters
 * - Valid characters: alphanumeric and hyphens
 * - No leading or trailing hyphens in labels
 * - Must have a valid public suffix (TLD)
 *
 * @param input - Domain name to validate
 * @returns Validation result with parsed components or error message
 */
export function validateDomain(input: string): DomainValidationResult {
  // Normalize input
  const normalized = input.toLowerCase().trim();

  if (!normalized) {
    return { valid: false, error: 'Domain cannot be empty' };
  }

  // First, do manual validation before parsing
  // This catches issues that tldts might be permissive about

  // Check total domain length (RFC 1035: max 253 characters)
  if (normalized.length > 253) {
    return { valid: false, error: 'Domain name too long (max 253 characters)' };
  }

  // Validate each label (split by dots)
  const labels = normalized.split('.');
  for (const label of labels) {
    // Check label length (RFC 1035: max 63 characters per label)
    if (label.length === 0) {
      return { valid: false, error: 'Invalid domain format' };
    }

    if (label.length > 63) {
      return { valid: false, error: 'Label too long (max 63 characters per label)' };
    }

    // Check for valid characters and hyphen placement
    // RFC 1035: alphanumeric and hyphens, no leading/trailing hyphens
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) {
      return {
        valid: false,
        error: 'Invalid characters or hyphen placement (no leading/trailing hyphens)',
      };
    }
  }

  // Parse using tldts (doesn't allow private domains like .local)
  const parsed = parse(normalized, { allowPrivateDomains: false });

  // Check if we got a valid domain and public suffix
  if (!parsed.domain || !parsed.publicSuffix) {
    return { valid: false, error: 'Invalid domain format or TLD' };
  }

  // Reject subdomains - we only support second-level domains
  if (parsed.subdomain) {
    return { valid: false, error: 'Subdomains are not supported' };
  }

  // All checks passed
  return {
    valid: true,
    domain: parsed.domain,
    sld: parsed.domainWithoutSuffix ?? undefined,
    tld: parsed.publicSuffix,
  };
}

/**
 * Zod schema for validating and transforming domain names
 */
export const domainValidator = z
  .string()
  .min(1, 'Domain cannot be empty')
  .transform((val: string) => val.toLowerCase().trim())
  .refine(
    (val: string) => {
      const result = validateDomain(val);
      return result.valid;
    },
    {
      message: 'Invalid domain format',
    }
  );

/**
 * Zod schema for batch domain check requests
 * Validates 1-10 domains in a single request
 */
export const batchCheckSchema = z.object({
  domains: z
    .array(domainValidator)
    .min(1, 'At least one domain is required')
    .max(10, 'Maximum 10 domains per request'),
});
