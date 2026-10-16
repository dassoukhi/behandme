import type { ArgumentsHost } from "@nestjs/common";
import {
  BadRequestException,
  ForbiddenException,
  Logger,
  ConflictException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  type DomainError,
  InvalidInputError,
  NotFoundError,
  UnprocessableError,
} from "@lib/kernel";
import {
  GlobalExceptionFilter,
  httpStatusOf,
} from "./global-exception.filter.js";

/** Status and body the filter sends for `exception`. */
function respond(exception: unknown) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: "GET", url: "/api/v1/users/x" }),
    }),
  } as unknown as ArgumentsHost;
  new GlobalExceptionFilter().catch(exception, host);
  const body = { ...res.json.mock.calls[0][0] };
  delete body.timestamp;
  return { status: res.status.mock.calls[0][0], body };
}

beforeAll(() => Logger.overrideLogger(false));

describe("global exception filter", () => {
  it.each<[string, DomainError, HttpException]>([
    [
      "NotFoundError",
      new NotFoundError("Profile not found"),
      new NotFoundException("Profile not found"),
    ],
    [
      "ConflictError",
      new ConflictError("User is already trusted"),
      new ConflictException("User is already trusted"),
    ],
    [
      "InvalidInputError",
      new InvalidInputError("You cannot trust yourself"),
      new BadRequestException("You cannot trust yourself"),
    ],
    [
      "UnprocessableError",
      new UnprocessableError("No email"),
      new UnprocessableEntityException("No email"),
    ],
  ])(
    "answers a %s exactly like the matching HTTP exception",
    (_name, domain, http) => {
      expect(respond(domain)).toEqual(respond(http));
    },
  );

  it("keeps Clerk's reverification hint in the body, for the app's useReverification", () => {
    const hint = {
      clerk_error: {
        type: "forbidden",
        reason: "reverification-error",
        metadata: {
          reverification: { level: "second_factor", afterMinutes: 10 },
        },
      },
    };
    const { status, body } = respond(new ForbiddenException(hint));
    expect(status).toBe(403);
    expect(body).toMatchObject({ statusCode: 403, ...hint });
    expect(respond(new ForbiddenException("No")).body).not.toHaveProperty(
      "clerk_error",
    );
  });

  it("logs a refused request as one warning line, an unexpected error with its stack", () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});
    const error = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    respond(new NotFoundError("Profile not found"));
    expect(warn).toHaveBeenCalledWith(
      "GET /api/v1/users/x - 404: Profile not found",
    );
    expect(error).not.toHaveBeenCalled();

    const crash = new Error("connection reset");
    respond(crash);
    expect(error).toHaveBeenCalledWith(
      "GET /api/v1/users/x - 500: connection reset",
      crash.stack,
    );
    warn.mockRestore();
    error.mockRestore();
  });

  it("answers an unexpected error with a 500 that keeps its details private", () => {
    const { status, body } = respond(
      new Error('duplicate key value violates unique constraint "users_pkey"'),
    );
    expect(status).toBe(500);
    expect(body).toEqual({
      statusCode: 500,
      path: "/api/v1/users/x",
      error: "Internal Server Error",
      message: "Internal server error",
    });
  });
});

describe("httpStatusOf", () => {
  it("gives the status the client gets: 4xx for refusals, 500 for the unexpected", () => {
    expect(httpStatusOf(new ConflictError("Already decided"))).toBe(409);
    expect(httpStatusOf(new NotFoundError("Contract not found"))).toBe(404);
    expect(httpStatusOf(new ForbiddenException("No"))).toBe(403);
    expect(httpStatusOf(new Error("connection reset"))).toBe(500);
  });
});
