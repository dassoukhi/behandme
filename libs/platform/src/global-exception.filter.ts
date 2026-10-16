import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  ConflictError,
  DomainError,
  InvalidInputError,
  NotFoundError,
  UnprocessableError,
} from "@lib/kernel";

/** The HTTP answer to a business rule refusal (same body as the matching Nest exception). */
function toHttpException(error: DomainError): HttpException {
  if (error instanceof NotFoundError)
    return new NotFoundException(error.message);
  if (error instanceof ConflictError)
    return new ConflictException(error.message);
  if (error instanceof InvalidInputError)
    return new BadRequestException(error.message);
  if (error instanceof UnprocessableError)
    return new UnprocessableEntityException(error.message);
  return new BadRequestException(error.message);
}

/** The HTTP status an exception is answered with (the same as GlobalExceptionFilter's). */
export function httpStatusOf(exception: unknown): number {
  const http =
    exception instanceof DomainError ? toHttpException(exception) : exception;
  return http instanceof HttpException
    ? http.getStatus()
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let error = "Internal Server Error";
    // Clerk's reverification hint (`clerk_error`): the app's useReverification looks for it in the body.
    let clerkError: unknown;

    const http =
      exception instanceof DomainError ? toHttpException(exception) : exception;
    if (http instanceof HttpException) {
      status = http.getStatus();
      const errorResponse = http.getResponse();

      if (typeof errorResponse === "object") {
        message = (errorResponse as any).message || message;
        error = (errorResponse as any).error || error;
        clerkError = (errorResponse as any).clerk_error;
        if (clerkError) message = "Verify your identity again";
      } else {
        message = errorResponse as string;
      }
    }

    // Unexpected errors (database, network…) keep their details in the logs, not in the response.
    // A refused request (4xx) is the caller's doing: one line, no stack.
    const detail = exception instanceof Error ? exception.message : message;
    const line = `${request.method} ${request.url} - ${status}: ${http instanceof HttpException ? message : detail}`;
    if (status >= 500) {
      this.logger.error(
        line,
        exception instanceof Error ? exception.stack : "",
      );
    } else {
      this.logger.warn(line);
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      error,
      message,
      ...(clerkError ? { clerk_error: clerkError } : {}),
    });
  }
}
