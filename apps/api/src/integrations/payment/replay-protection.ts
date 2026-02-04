import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { paymentRecords } from '../../db/schema';

/**
 * Error thrown when attempting to record a payment ID that has already been used.
 */
export class DuplicatePaymentError extends Error {
  constructor(paymentId: string) {
    super(`Payment ID already used: ${paymentId}`);
    this.name = 'DuplicatePaymentError';

    // Restore prototype chain for instanceof checks
    Object.setPrototypeOf(this, DuplicatePaymentError.prototype);
  }
}

export interface PaymentRecord {
  paymentId: string;
  walletAddress: string;
  amount: string;
  network: string;
  domain?: string;
}

/**
 * Checks if a payment ID has been used before.
 *
 * @param db - Drizzle database instance (synchronous with bun:sqlite)
 * @param paymentId - The payment ID to check
 * @returns true if payment has been used, false otherwise
 */
export function hasPaymentBeenUsed(
  db: BunSQLiteDatabase<any>,
  paymentId: string
): boolean {
  const result = db
    .select({ id: paymentRecords.id })
    .from(paymentRecords)
    .where(eq(paymentRecords.paymentId, paymentId))
    .get();

  return result !== undefined;
}

/**
 * Records a new payment in the database.
 *
 * @param db - Drizzle database instance (synchronous with bun:sqlite)
 * @param payment - Payment details to record
 * @throws {DuplicatePaymentError} If the payment ID has already been used
 *
 * Note: This function is synchronous because Drizzle with bun:sqlite is synchronous.
 * The SQLite UNIQUE constraint on payment_id provides atomic duplicate detection.
 */
export function recordPayment(
  db: BunSQLiteDatabase<any>,
  payment: PaymentRecord
): void {
  try {
    db.insert(paymentRecords).values({
      paymentId: payment.paymentId,
      walletAddress: payment.walletAddress,
      amount: payment.amount,
      network: payment.network,
      domain: payment.domain,
    }).run();
  } catch (error) {
    // SQLite UNIQUE constraint violation
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      throw new DuplicatePaymentError(payment.paymentId);
    }
    throw error;
  }
}
