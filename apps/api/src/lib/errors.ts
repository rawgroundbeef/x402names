import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Hook } from '@hono/zod-validator';
import {
  RegistrarError,
  RegistrarUnavailable,
  RegistrarAuthError,
  RegistrarRateLimitError,
  DomainTaken,
  InvalidTLD,
} from '../integrations/registrar/types';

/**
 * RFC 9457 Problem Details for HTTP APIs
 * https://www.rfc-editor.org/rfc/rfc9457.html
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
}

/**
 * Create an RFC 9457 Problem Details response
 *
 * @param c - Hono context
 * @param status - HTTP status code
 * @param type - Machine-readable error type (e.g., "error:validation")
 * @param title - Human-readable error title
 * @param detail - Detailed error message
 * @returns JSON response with Problem Details
 */
export function createProblemResponse(
  c: Context,
  status: number,
  type: string,
  title: string,
  detail: string
) {
  const requestId = c.req.header('x-request-id');

  const problem: ProblemDetails = {
    type,
    title,
    status,
    detail,
  };

  if (requestId) {
    problem.instance = requestId;
  }

  return c.json(problem, status as any);
}

/**
 * Global error handler that formats all errors as RFC 9457 Problem Details
 */
export const problemDetailsErrorHandler: ErrorHandler = (err, c) => {
  // Handle Hono's built-in HTTPException
  if (err instanceof HTTPException) {
    const status = err.status;
    return createProblemResponse(
      c,
      status,
      `error:${status}`,
      err.message,
      err.message
    );
  }

  // Handle registrar-specific errors
  if (err instanceof RegistrarUnavailable) {
    return createProblemResponse(
      c,
      503,
      'error:registrar_unavailable',
      'Registrar Unavailable',
      err.message
    );
  }

  if (err instanceof RegistrarAuthError) {
    return createProblemResponse(
      c,
      503,
      'error:registrar_auth',
      'Registrar Authentication Failed',
      err.message
    );
  }

  if (err instanceof RegistrarRateLimitError) {
    return createProblemResponse(
      c,
      429,
      'error:rate_limit',
      'Rate Limit Exceeded',
      err.message
    );
  }

  if (err instanceof DomainTaken) {
    return createProblemResponse(
      c,
      409,
      'error:domain_taken',
      'Domain Already Taken',
      err.message
    );
  }

  if (err instanceof InvalidTLD) {
    return createProblemResponse(
      c,
      400,
      'error:invalid_tld',
      'Invalid TLD',
      err.message
    );
  }

  if (err instanceof RegistrarError) {
    return createProblemResponse(
      c,
      502,
      'error:registrar',
      'Registrar Error',
      err.message
    );
  }

  // Unknown errors
  console.error('Unhandled error:', err);
  return createProblemResponse(
    c,
    500,
    'error:internal',
    'Internal Server Error',
    'An unexpected error occurred'
  );
};

/**
 * Validation error hook for @hono/zod-validator
 * Formats validation errors as RFC 9457 Problem Details
 */
export const validationErrorHook: Hook<any, any, any, any> = (result, c) => {
  if (!result.success) {
    // Handle both $ZodError (runtime) and ZodError types
    const errors = 'errors' in result.error ? result.error.errors : [];
    const firstError = errors[0];
    const detail = firstError
      ? `${firstError.path.join('.')}: ${firstError.message}`
      : 'Validation failed';

    return createProblemResponse(
      c,
      400,
      'error:validation',
      'Validation Error',
      detail
    );
  }
};
