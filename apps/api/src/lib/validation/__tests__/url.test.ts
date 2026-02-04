import { describe, expect, test } from 'bun:test';
import { validateTargetUrl } from '../url';

describe('validateTargetUrl', () => {
  describe('valid URLs', () => {
    test('accepts basic HTTPS URL', () => {
      const result = validateTargetUrl('https://example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('accepts HTTP URL with path and query', () => {
      const result = validateTargetUrl('http://example.com/path?query=value');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('accepts URL with subdomain', () => {
      const result = validateTargetUrl('https://sub.domain.example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('accepts URL with custom port', () => {
      const result = validateTargetUrl('https://example.com:8080');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('accepts URL with exactly 2048 characters', () => {
      const longPath = 'a'.repeat(2048 - 'https://example.com/'.length);
      const result = validateTargetUrl(`https://example.com/${longPath}`);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('invalid schemes', () => {
    test('rejects FTP scheme', () => {
      const result = validateTargetUrl('ftp://example.com');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Only HTTP and HTTPS protocols are allowed');
    });

    test('rejects javascript scheme', () => {
      const result = validateTargetUrl('javascript:alert(1)');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Only HTTP and HTTPS protocols are allowed');
    });

    test('rejects data URI scheme', () => {
      const result = validateTargetUrl('data:text/html,<h1>hi</h1>');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Only HTTP and HTTPS protocols are allowed');
    });

    test('rejects file scheme', () => {
      const result = validateTargetUrl('file:///etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Only HTTP and HTTPS protocols are allowed');
    });
  });

  describe('localhost and private addresses', () => {
    test('rejects localhost hostname', () => {
      const result = validateTargetUrl('http://localhost');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Localhost URLs are not allowed');
    });

    test('rejects 127.0.0.1', () => {
      const result = validateTargetUrl('http://127.0.0.1');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Localhost URLs are not allowed');
    });

    test('rejects IPv6 localhost [::1]', () => {
      const result = validateTargetUrl('http://[::1]');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Localhost URLs are not allowed');
    });

    test('rejects 0.0.0.0', () => {
      const result = validateTargetUrl('http://0.0.0.0');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Localhost URLs are not allowed');
    });

    test('rejects 10.0.0.0/8 private range', () => {
      const result = validateTargetUrl('http://10.0.0.1');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Private IP addresses are not allowed');
    });

    test('rejects 172.16.0.0/12 private range', () => {
      const result = validateTargetUrl('http://172.16.0.1');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Private IP addresses are not allowed');
    });

    test('rejects 192.168.0.0/16 private range', () => {
      const result = validateTargetUrl('http://192.168.1.1');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Private IP addresses are not allowed');
    });

    test('rejects 127.x.x.x loopback range', () => {
      const result = validateTargetUrl('http://127.5.10.15');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Private IP addresses are not allowed');
    });
  });

  describe('cloud metadata endpoints', () => {
    test('rejects 169.254.169.254 metadata endpoint', () => {
      const result = validateTargetUrl('http://169.254.169.254');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Metadata service URLs are not allowed');
    });

    test('rejects metadata.google.internal', () => {
      const result = validateTargetUrl('http://metadata.google.internal');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Metadata service URLs are not allowed');
    });

    test('rejects any 169.254.x.x address (link-local)', () => {
      const result = validateTargetUrl('http://169.254.1.1');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Private IP addresses are not allowed');
    });
  });

  describe('embedded credentials', () => {
    test('rejects URL with username and password', () => {
      const result = validateTargetUrl('http://user:pass@example.com');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('URLs with embedded credentials are not allowed');
    });

    test('rejects URL with username only', () => {
      const result = validateTargetUrl('http://user@example.com');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('URLs with embedded credentials are not allowed');
    });
  });

  describe('length validation', () => {
    test('rejects URL exceeding 2048 characters', () => {
      const longPath = 'a'.repeat(2049 - 'https://example.com/'.length);
      const result = validateTargetUrl(`https://example.com/${longPath}`);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('URL exceeds maximum length (2048 characters)');
    });
  });

  describe('malformed URLs', () => {
    test('rejects non-URL string', () => {
      const result = validateTargetUrl('not-a-url');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid URL format');
    });

    test('rejects empty string', () => {
      const result = validateTargetUrl('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid URL format');
    });
  });

  describe('edge cases', () => {
    test('accepts 172.15.255.255 (NOT in 172.16.0.0/12 range)', () => {
      const result = validateTargetUrl('http://172.15.255.255');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('accepts 172.32.0.0 (NOT in 172.16.0.0/12 range)', () => {
      const result = validateTargetUrl('http://172.32.0.0');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('accepts 11.0.0.1 (NOT in 10.0.0.0/8 range)', () => {
      const result = validateTargetUrl('http://11.0.0.1');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('error aggregation', () => {
    test('returns multiple errors for URL with multiple issues', () => {
      // FTP + embedded credentials
      const result = validateTargetUrl('ftp://user:pass@example.com');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors).toContain('Only HTTP and HTTPS protocols are allowed');
      expect(result.errors).toContain('URLs with embedded credentials are not allowed');
    });

    test('returns multiple errors for private IP with credentials', () => {
      const result = validateTargetUrl('http://user:pass@192.168.1.1');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors).toContain('Private IP addresses are not allowed');
      expect(result.errors).toContain('URLs with embedded credentials are not allowed');
    });
  });
});
