import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { registrationJobs } from '../../db/schema';
import { createProblemResponse } from '../../lib/errors';

/**
 * Factory function to create registration status routes
 */
export function createStatusRoutes(db: BunSQLiteDatabase<any>) {
  const router = new Hono();

  /**
   * GET /registrations/:jobId/status
   * Get the status of a registration job (LRO pattern)
   */
  router.get('/:jobId/status', (c) => {
    const jobId = c.req.param('jobId');

    const job = db
      .select()
      .from(registrationJobs)
      .where(eq(registrationJobs.id, jobId))
      .get();

    if (!job) {
      return createProblemResponse(
        c,
        404,
        'error:job_not_found',
        'Job Not Found',
        `Registration job ${jobId} not found`
      );
    }

    switch (job.state) {
      case 'processing':
        return c.json({
          state: 'processing',
          progress: job.progress,
          currentStep: job.currentStep,
          retryAfterSeconds: 2,
        });

      case 'succeeded':
        return c.json({
          state: 'succeeded',
          artifactUrl: `/domains/${job.domainName}/status`,
          domain: job.domainName,
          ownerWallet: job.ownerWallet,
          response: `Domain ${job.domainName} registered successfully`,
        });

      case 'failed':
        return c.json({
          state: 'failed',
          error: job.error || 'Registration failed',
          code: job.errorCode || 'unknown_error',
          domain: job.domainName,
        });

      default:
        return createProblemResponse(
          c,
          500,
          'error:invalid_state',
          'Invalid Job State',
          `Job has invalid state: ${job.state}`
        );
    }
  });

  return router;
}
