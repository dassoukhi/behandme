import type { NextFunction, Request, Response } from "express";
import { newId, withCorrelation } from "@lib/kernel";

export const CORRELATION_HEADER = "x-correlation-id";
const VALID = /^[\w-]{8,64}$/;

/**
 * Runs each request with a correlation id: the caller's (another service) when it sends a valid
 * one, a new one otherwise. Sent back in the response header.
 */
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const received = req.header(CORRELATION_HEADER);
  const correlationId = received && VALID.test(received) ? received : newId();
  res.setHeader(CORRELATION_HEADER, correlationId);
  withCorrelation(correlationId, next);
}
