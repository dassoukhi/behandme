/**
 * A request that a business rule refuses. Domain and application code throw these; the interface
 * layer turns them into a response (HTTP status, message), so the rules stay free of transport.
 */
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The input breaks a rule (HTTP 400). */
export class InvalidInputError extends DomainError {}

/** The resource does not exist or the caller may not see it (HTTP 404). */
export class NotFoundError extends DomainError {}

/** The request clashes with the current state (HTTP 409). */
export class ConflictError extends DomainError {}

/** Well-formed, but cannot be processed in the current situation (HTTP 422). */
export class UnprocessableError extends DomainError {}
