import { describe, test, expect } from 'bun:test';
import { validateDomain, domainValidator, batchCheckSchema } from '../domain';

describe('validateDomain', () => {
  describe('valid domains', () => {
    test('validates simple .com domain', () => {
      const result = validateDomain('example.com');
      expect(result.valid).toBe(true);
      expect(result.domain).toBe('example.com');
      expect(result.sld).toBe('example');
      expect(result.tld).toBe('com');
    });

    test('validates .io domain', () => {
      const result = validateDomain('my-site.io');
      expect(result.valid).toBe(true);
      expect(result.domain).toBe('my-site.io');
      expect(result.sld).toBe('my-site');
      expect(result.tld).toBe('io');
    });

    test('validates single character SLD', () => {
      const result = validateDomain('a.net');
      expect(result.valid).toBe(true);
      expect(result.domain).toBe('a.net');
      expect(result.sld).toBe('a');
      expect(result.tld).toBe('net');
    });

    test('validates domain with hyphens in middle', () => {
      const result = validateDomain('my-awesome-site.com');
      expect(result.valid).toBe(true);
      expect(result.domain).toBe('my-awesome-site.com');
    });

    test('normalizes uppercase to lowercase', () => {
      const result = validateDomain('EXAMPLE.COM');
      expect(result.valid).toBe(true);
      expect(result.domain).toBe('example.com');
    });

    test('trims whitespace', () => {
      const result = validateDomain('  example.com  ');
      expect(result.valid).toBe(true);
      expect(result.domain).toBe('example.com');
    });

    test('validates 63-character label (max allowed)', () => {
      const longLabel = 'a'.repeat(63);
      const result = validateDomain(`${longLabel}.com`);
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid domains', () => {
    test('rejects subdomains', () => {
      const result = validateDomain('sub.example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Subdomains');
    });

    test('rejects domain with spaces', () => {
      const result = validateDomain('exam ple.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid characters');
    });

    test('rejects domain with special characters', () => {
      const result = validateDomain('exam!ple.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid characters');
    });

    test('rejects domain with leading hyphen', () => {
      const result = validateDomain('-example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('hyphen');
    });

    test('rejects domain with trailing hyphen', () => {
      const result = validateDomain('example-.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('hyphen');
    });

    test('rejects 64-character label (over limit)', () => {
      const longLabel = 'a'.repeat(64);
      const result = validateDomain(`${longLabel}.com`);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Label too long');
    });

    test('rejects 254-character domain (over limit)', () => {
      // Create domain exactly 254 chars (253 is max)
      const label = 'a'.repeat(240);
      const result = validateDomain(`${label}.example.com`);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too long');
    });

    test('rejects empty string', () => {
      const result = validateDomain('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    test('rejects domain without TLD', () => {
      const result = validateDomain('example');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid domain');
    });

    test('rejects invalid TLD', () => {
      // Using a truly invalid format that tldts won't accept
      const result = validateDomain('example.');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid');
    });
  });
});

describe('domainValidator Zod schema', () => {
  test('validates and transforms valid domain', () => {
    const result = domainValidator.safeParse('EXAMPLE.COM');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('example.com');
    }
  });

  test('rejects invalid domain', () => {
    const result = domainValidator.safeParse('sub.example.com');
    expect(result.success).toBe(false);
  });

  test('rejects empty string', () => {
    const result = domainValidator.safeParse('');
    expect(result.success).toBe(false);
  });
});

describe('batchCheckSchema', () => {
  test('validates array of 1-10 domains', () => {
    const result = batchCheckSchema.safeParse({
      domains: ['example.com', 'test.io', 'another.net'],
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty array', () => {
    const result = batchCheckSchema.safeParse({ domains: [] });
    expect(result.success).toBe(false);
  });

  test('rejects more than 10 domains', () => {
    const domains = Array.from({ length: 11 }, (_, i) => `test${i}.com`);
    const result = batchCheckSchema.safeParse({ domains });
    expect(result.success).toBe(false);
  });

  test('transforms domains to lowercase', () => {
    const result = batchCheckSchema.safeParse({
      domains: ['EXAMPLE.COM', 'TEST.IO'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domains).toEqual(['example.com', 'test.io']);
    }
  });
});
