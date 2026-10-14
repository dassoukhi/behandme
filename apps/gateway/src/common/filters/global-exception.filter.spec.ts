import type { ArgumentsHost } from "@nestjs/common";
import {
  BadRequestException,
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
import { GlobalExceptionFilter } from "./global-exception.filter.js";

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
