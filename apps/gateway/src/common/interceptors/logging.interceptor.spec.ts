import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { lastValueFrom, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { ConflictError } from "@lib/kernel";
import { LoggingInterceptor } from "./logging.interceptor.js";

const context = {
  switchToHttp: () => ({
    getRequest: () => ({
      method: "POST",
      url: "/api/v1/contracts/c1/claims",
      ip: "::1",
      get: () => "test",
    }),
    getResponse: () => ({ statusCode: 200 }),
  }),
} as unknown as ExecutionContext;

const failing = (error: unknown): CallHandler => ({
  handle: () => throwError(() => error),
});

describe("LoggingInterceptor", () => {
  it("logs a business refusal with its real status, as a warning, not as a 500 error", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});
    const error = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    await expect(
      lastValueFrom(
        new LoggingInterceptor().intercept(
          context,
          failing(new ConflictError("Not possible now: claim")),
        ),
      ),
    ).rejects.toThrow(ConflictError);
    expect(warn.mock.calls[0][0]).toMatch(
      /^POST \/api\/v1\/contracts\/c1\/claims 409 /,
    );
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it("logs an unexpected error as a 500 error", async () => {
    const error = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    await expect(
      lastValueFrom(
        new LoggingInterceptor().intercept(context, failing(new Error("boom"))),
      ),
    ).rejects.toThrow("boom");
    expect(error.mock.calls[0][0]).toMatch(/ 500 /);
    error.mockRestore();
  });
});
