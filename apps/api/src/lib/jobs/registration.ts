/**
 * Registration job processor with retry logic
 *
 * Processes domain registration jobs asynchronously with exponential backoff retry.
 * Submits domains to the registrar, tracks progress, and handles failures.
 */

import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { registrationJobs, domains } from '../../db/schema';
import type { DomainRegistrar, ContactInfo } from '../../integrations/registrar/types';
import { env } from '../../config/env';
import { validateDomain } from '../validation/domain';
import { enqueueJob } from './queue';

// Constants
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

/**
 * Get default contact info from environment variables
 */
export function getDefaultContactInfo(): ContactInfo {
  return {
    firstName: env.REGISTRAR_CONTACT_FIRST_NAME,
    lastName: env.REGISTRAR_CONTACT_LAST_NAME,
    address1: env.REGISTRAR_CONTACT_ADDRESS,
    city: env.REGISTRAR_CONTACT_CITY,
    stateProvince: env.REGISTRAR_CONTACT_STATE,
    postalCode: env.REGISTRAR_CONTACT_POSTAL,
    country: env.REGISTRAR_CONTACT_COUNTRY,
    phone: env.REGISTRAR_CONTACT_PHONE,
    email: env.REGISTRAR_CONTACT_EMAIL,
  };
}

/**
 * Create a job processor with injected dependencies
 *
 * @param registrar - DomainRegistrar implementation
 * @param db - Database instance
 * @returns Object with processJob method
 */
export function createJobProcessor(
  registrar: DomainRegistrar,
  db: BunSQLiteDatabase<any>
) {
  /**
   * Process a single registration job
   *
   * @param jobId - Job ID to process
   */
  async function processJob(jobId: string): Promise<void> {
    // Load job from database
    const job = db
      .select()
      .from(registrationJobs)
      .where(eq(registrationJobs.id, jobId))
      .get();

    // Guard: job not found or not in processing state
    if (!job || job.state !== 'processing') {
      return;
    }

    // Guard: max attempts exceeded
    if ((job.attempts || 0) >= MAX_ATTEMPTS) {
      db.update(registrationJobs)
        .set({
          state: 'failed',
          error: `Registration failed after ${MAX_ATTEMPTS} attempts`,
          errorCode: 'max_attempts_exceeded',
          completedAt: new Date(),
        } as any)
        .where(eq(registrationJobs.id, jobId))
        .run();
      return;
    }

    try {
      // Step 1: Mark payment as verified
      db.update(registrationJobs)
        .set({
          progress: 33,
          currentStep: 'payment_verified',
        } as any)
        .where(eq(registrationJobs.id, jobId))
        .run();

      // Step 2: Submit to registrar
      db.update(registrationJobs)
        .set({
          progress: 66,
          currentStep: 'registrar_submitted',
        } as any)
        .where(eq(registrationJobs.id, jobId))
        .run();

      const contactInfo = getDefaultContactInfo();
      const result = await registrar.register(job.domainName, 1, contactInfo);

      if (!result.success) {
        throw new Error(`Registration failed for ${job.domainName}`);
      }

      // Step 3: Create domain record
      const validation = validateDomain(job.domainName);
      if (!validation.valid) {
        throw new Error(`Invalid domain: ${validation.error}`);
      }

      db.insert(domains)
        .values({
          name: job.domainName,
          tld: job.tld,
          status: 'registered',
          ownerWallet: job.ownerWallet,
          targetUrl: job.targetUrl || null,
          paymentId: job.paymentId,
          registrarOrderId: result.orderId || result.transactionId,
        } as any)
        .run();

      // Mark job as succeeded
      db.update(registrationJobs)
        .set({
          state: 'succeeded',
          progress: 100,
          currentStep: 'completed',
          registrarOrderId: result.orderId || result.transactionId,
          completedAt: new Date(),
        } as any)
        .where(eq(registrationJobs.id, jobId))
        .run();
    } catch (error) {
      const nextAttempt = (job.attempts || 0) + 1;

      if (nextAttempt >= MAX_ATTEMPTS) {
        // Permanently failed
        db.update(registrationJobs)
          .set({
            state: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            errorCode: 'registration_failed',
            attempts: nextAttempt,
            completedAt: new Date(),
          } as any)
          .where(eq(registrationJobs.id, jobId))
          .run();
      } else {
        // Schedule retry with exponential backoff
        const delayMs = Math.pow(2, nextAttempt) * BASE_DELAY_MS;
        const nextRetryAt = new Date(Date.now() + delayMs);

        db.update(registrationJobs)
          .set({
            attempts: nextAttempt,
            nextRetryAt,
            error: error instanceof Error ? error.message : 'Unknown error',
          } as any)
          .where(eq(registrationJobs.id, jobId))
          .run();

        // Re-enqueue for retry
        enqueueJob(jobId, () => processJob(jobId), delayMs);
      }
    }
  }

  return {
    processJob,
  };
}
