// Shared error shapes so every route reports failures the same way and
// docs/API_SPEC.yaml's error responses stay honest.

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Thrown by service methods whose owner hasn't implemented them yet.
 * The route layer maps this to HTTP 501 so an unfinished module is
 * obvious in the API response instead of surfacing as a generic 500.
 */
export class NotImplementedError extends HttpError {
  constructor(what: string) {
    super(501, `${what} is not implemented yet`, "NOT_IMPLEMENTED");
    this.name = "NotImplementedError";
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Action not permitted for this role") {
    super(403, message, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "No valid session") {
    super(401, message, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Resource not found") {
    super(404, message, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ValidationError extends HttpError {
  constructor(public readonly errors: string[]) {
    super(400, errors.join("; ") || "Invalid request body", "VALIDATION_FAILED");
    this.name = "ValidationError";
  }
}

export class ConflictError extends HttpError {
  constructor(message = "The requested state transition conflicts with current state") {
    super(409, message, "CONFLICT");
    this.name = "ConflictError";
  }
}
