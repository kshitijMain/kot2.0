import { NotFoundException } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { runWithRequestContext } from '../common/request-context.js';
import { isBodyParserError, mapError } from '../errors/error-mapping.js';
import { CORRELATION_HEADER, resolveCorrelationId } from '../logging/correlation.js';

type RequestWithId = Request & { id?: unknown };

/**
 * First middleware of every request: assigns the correlation ID before anything else can fail,
 * so even body-parsing errors carry one (NFR-O01). The logger reuses `req.id`; services (for
 * example the audit log) read it from the request context.
 */
export function correlationMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const id = resolveCorrelationId(request.headers[CORRELATION_HEADER]);
  (request as RequestWithId).id = id;
  response.setHeader(CORRELATION_HEADER, id);
  runWithRequestContext({ correlationId: id }, next);
}

/**
 * Answers malformed or oversized JSON bodies in the ApiError shape. Runs straight after the JSON
 * parser; every other error continues to the Nest exception filter.
 */
export function bodyParserErrorHandler(
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!isBodyParserError(error)) {
    next(error);
    return;
  }
  const id = (request as RequestWithId).id;
  const mapped = mapError(error, typeof id === 'string' ? id : undefined);
  response.status(mapped.status).json(mapped.body);
}

/** Whether a parsed body or query holds a NUL character anywhere, however deep. */
function holdsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 64 || typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return value.some((entry) => holdsNul(entry, depth + 1));
  return Object.entries(value).some(
    ([key, entry]) => key.includes('\u0000') || holdsNul(entry, depth + 1),
  );
}

/**
 * Refuses text with a NUL character in a body or query, which PostgreSQL cannot store: without
 * this the write failed with a 500 (QA-003), and a phone's order outbox retried it forever ahead
 * of every later order. Runs after the JSON parser.
 */
export function refuseNulText(request: Request, response: Response, next: NextFunction): void {
  if (!holdsNul(request.body) && !holdsNul(request.query)) {
    next();
    return;
  }
  const id = (request as RequestWithId).id;
  response.status(400).json({
    code: 'INVALID_TEXT',
    message: 'Some text holds a hidden control character. Retype it and try again.',
    ...(typeof id === 'string' && { correlationId: id }),
  });
}

/**
 * Last: a path outside the API that nothing before served (the console's files, the CA) is a 404
 * in the ApiError shape, with the security headers already set. Nest answers unknown paths only
 * under its prefix; without this, Express's own HTML page would answer the rest and replace the
 * CSP (found by the DAST scan, P8-03c1).
 */
export function notFoundOutsideApi(prefix: string): RequestHandler {
  const root = `/${prefix}`;
  return (request, response, next) => {
    if (request.path === root || request.path.startsWith(`${root}/`)) {
      next();
      return;
    }
    const id = (request as RequestWithId).id;
    const mapped = mapError(
      new NotFoundException(`Cannot ${request.method} ${request.path}`),
      typeof id === 'string' ? id : undefined,
    );
    response.status(mapped.status).json(mapped.body);
  };
}
