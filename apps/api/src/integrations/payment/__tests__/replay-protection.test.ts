import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import {
  recordPayment,
  hasPaymentBeenUsed,
  DuplicatePaymentError,
  type PaymentRecord,
} from '../replay-protection';

describe('recordPayment', () => {
  let sqlite: Database;
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    // Create in-memory database with payment_records table
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE payment_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id TEXT NOT NULL UNIQUE,
        wallet_address TEXT NOT NULL,
        amount TEXT NOT NULL,
        network TEXT NOT NULL,
        domain TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
    db = drizzle(sqlite);
  });

  test('successfully records a new payment', () => {
    const payment: PaymentRecord = {
      paymentId: 'test-payment-1',
      walletAddress: '0x1234567890abcdef',
      amount: '5000000',
      network: 'eip155:84532',
      domain: 'example.x402',
    };

    expect(() => recordPayment(db, payment)).not.toThrow();
  });

  test('after recording, hasPaymentBeenUsed returns true', () => {
    const payment: PaymentRecord = {
      paymentId: 'test-payment-2',
      walletAddress: '0x1234567890abcdef',
      amount: '5000000',
      network: 'eip155:84532',
    };

    recordPayment(db, payment);
    expect(hasPaymentBeenUsed(db, 'test-payment-2')).toBe(true);
  });

  test('throws DuplicatePaymentError on same payment_id', () => {
    const payment: PaymentRecord = {
      paymentId: 'test-payment-3',
      walletAddress: '0x1234567890abcdef',
      amount: '5000000',
      network: 'eip155:84532',
    };

    recordPayment(db, payment);

    expect(() => recordPayment(db, payment)).toThrow(DuplicatePaymentError);
    expect(() => recordPayment(db, payment)).toThrow('Payment ID already used: test-payment-3');
  });

  test('different payment_ids do not conflict', () => {
    const payment1: PaymentRecord = {
      paymentId: 'test-payment-4',
      walletAddress: '0x1234567890abcdef',
      amount: '5000000',
      network: 'eip155:84532',
    };

    const payment2: PaymentRecord = {
      paymentId: 'test-payment-5',
      walletAddress: '0x1234567890abcdef',
      amount: '5000000',
      network: 'eip155:84532',
    };

    recordPayment(db, payment1);
    expect(() => recordPayment(db, payment2)).not.toThrow();
  });

  test('payment record stores all fields correctly', () => {
    const payment: PaymentRecord = {
      paymentId: 'test-payment-6',
      walletAddress: '0xabcdef1234567890',
      amount: '10000000',
      network: 'eip155:8453',
      domain: 'test.x402',
    };

    recordPayment(db, payment);

    // Query the record directly to verify all fields
    const result = sqlite.query('SELECT * FROM payment_records WHERE payment_id = ?').get('test-payment-6') as any;

    expect(result).toBeDefined();
    expect(result.payment_id).toBe('test-payment-6');
    expect(result.wallet_address).toBe('0xabcdef1234567890');
    expect(result.amount).toBe('10000000');
    expect(result.network).toBe('eip155:8453');
    expect(result.domain).toBe('test.x402');
    expect(result.created_at).toBeGreaterThan(0);
  });
});

describe('hasPaymentBeenUsed', () => {
  let sqlite: Database;
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE payment_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id TEXT NOT NULL UNIQUE,
        wallet_address TEXT NOT NULL,
        amount TEXT NOT NULL,
        network TEXT NOT NULL,
        domain TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
    db = drizzle(sqlite);
  });

  test('returns false for unknown payment_id', () => {
    expect(hasPaymentBeenUsed(db, 'nonexistent-payment')).toBe(false);
  });

  test('returns true for recorded payment_id', () => {
    const payment: PaymentRecord = {
      paymentId: 'known-payment',
      walletAddress: '0x1234567890abcdef',
      amount: '5000000',
      network: 'eip155:84532',
    };

    recordPayment(db, payment);
    expect(hasPaymentBeenUsed(db, 'known-payment')).toBe(true);
  });
});

describe('DuplicatePaymentError', () => {
  test('has correct name property', () => {
    const error = new DuplicatePaymentError('test-id');
    expect(error.name).toBe('DuplicatePaymentError');
  });

  test('has descriptive message with payment_id', () => {
    const error = new DuplicatePaymentError('my-payment-123');
    expect(error.message).toBe('Payment ID already used: my-payment-123');
  });

  test('instanceof Error is true', () => {
    const error = new DuplicatePaymentError('test-id');
    expect(error instanceof Error).toBe(true);
  });

  test('instanceof DuplicatePaymentError is true', () => {
    const error = new DuplicatePaymentError('test-id');
    expect(error instanceof DuplicatePaymentError).toBe(true);
  });
});
