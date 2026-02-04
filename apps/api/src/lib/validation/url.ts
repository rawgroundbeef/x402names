/**
 * URL validation with SSRF prevention
 *
 * Protects against:
 * - Server-Side Request Forgery (SSRF)
 * - Private IP address access
 * - Cloud metadata endpoints
 * - Non-HTTP(S) schemes
 * - Embedded credentials
 */

/**
 * URL validation result
 */
export interface UrlValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Check if an IPv4 address is in a private range
 *
 * Private ranges:
 * - 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
 * - 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
 * - 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)
 * - 127.0.0.0/8 (127.0.0.0 - 127.255.255.255) loopback
 * - 169.254.0.0/16 (169.254.0.0 - 169.254.255.255) link-local
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);

  if (parts.length !== 4 || parts.some(isNaN)) {
    return false;
  }

  const [a, b, c, d] = parts;

  // 10.0.0.0/8
  if (a === 10) {
    return true;
  }

  // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }

  // 192.168.0.0/16
  if (a === 192 && b === 168) {
    return true;
  }

  // 127.0.0.0/8 (loopback)
  if (a === 127) {
    return true;
  }

  // 169.254.0.0/16 (link-local, includes metadata endpoint)
  if (a === 169 && b === 254) {
    return true;
  }

  return false;
}

/**
 * Validate a target URL for safety and correctness
 *
 * Checks performed (all failures collected):
 * - Length <= 2048 characters
 * - Valid URL format (parseable)
 * - Protocol is http: or https:
 * - Not localhost
 * - Not private IP address
 * - Not cloud metadata endpoint
 * - No embedded credentials
 *
 * @param input - URL string to validate
 * @returns Validation result with all error messages
 */
export function validateTargetUrl(input: string): UrlValidationResult {
  const errors: string[] = [];

  // Check length first
  if (input.length > 2048) {
    errors.push('URL exceeds maximum length (2048 characters)');
  }

  // Try to parse URL
  let url: URL;
  try {
    url = new URL(input);
  } catch (error) {
    // If we can't parse, we can't validate further
    return {
      valid: false,
      errors: ['Invalid URL format']
    };
  }

  // Protocol check
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    errors.push('Only HTTP and HTTPS protocols are allowed');
  }

  const hostname = url.hostname.toLowerCase();

  // Localhost check
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]'
  ) {
    errors.push('Localhost URLs are not allowed');
  }

  // Private IPv4 check
  if (isPrivateIPv4(hostname)) {
    errors.push('Private IP addresses are not allowed');
  }

  // Cloud metadata endpoints
  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal'
  ) {
    errors.push('Metadata service URLs are not allowed');
  }

  // Embedded credentials check
  if (url.username || url.password) {
    errors.push('URLs with embedded credentials are not allowed');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
