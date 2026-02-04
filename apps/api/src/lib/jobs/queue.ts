/**
 * In-memory job queue with setTimeout-based scheduling
 *
 * Simple async job queue for processing registration jobs with optional delays.
 * Uses setTimeout for scheduling and tracks active timers for cleanup.
 */

// Map of job ID to timer handle for tracking active jobs
const activeTimers = new Map<string, Timer>();

/**
 * Enqueue a job for processing with optional delay
 *
 * @param jobId - Unique identifier for the job
 * @param processFn - Async function to execute
 * @param delayMs - Optional delay before execution (default: 0)
 */
export function enqueueJob(
  jobId: string,
  processFn: () => Promise<void>,
  delayMs: number = 0
): void {
  // Clear existing timer if job is already scheduled
  if (activeTimers.has(jobId)) {
    clearTimeout(activeTimers.get(jobId));
    activeTimers.delete(jobId);
  }

  // Schedule the job
  const timer = setTimeout(async () => {
    activeTimers.delete(jobId);
    try {
      await processFn();
    } catch (error) {
      console.error(`Job ${jobId} failed:`, error);
    }
  }, delayMs);

  activeTimers.set(jobId, timer);
}

/**
 * Cancel a scheduled job
 *
 * @param jobId - Job ID to cancel
 */
export function cancelJob(jobId: string): void {
  const timer = activeTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(jobId);
  }
}

/**
 * Clear all active timers (for graceful shutdown and testing)
 */
export function clearAllJobs(): void {
  activeTimers.forEach((timer) => {
    clearTimeout(timer);
  });
  activeTimers.clear();
}

/**
 * Get count of active scheduled jobs
 */
export function getActiveJobCount(): number {
  return activeTimers.size;
}
