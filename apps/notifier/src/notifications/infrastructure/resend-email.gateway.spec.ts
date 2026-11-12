import { describe, expect, it, vi } from "vitest";
import type { EmailContent } from "../domain/email.js";
import { LOGO_PNG_BASE64 } from "./email/logo.js";
import {
  disabledEmailGateway,
  interpretError,
  type ResendClient,
  ResendEmailGateway,
} from "./resend-email.gateway.js";

const content: EmailContent = {
  language: "fr",
  critical: true,
  subject: "Demande de transmission : « Réseaux sociaux »",
  greetingName: "Alice",
  paragraphs: ["Bob Durand a demandé la transmission."],
  facts: [],
};

function client(answer: () => Promise<unknown>) {
  const send = vi.fn(answer);
  return { client: { emails: { send } } as unknown as ResendClient, send };
}

describe("ResendEmailGateway", () => {
  it("sends the rendered e-mail with the logo inline and the idempotency key", async () => {
    const { client: resend, send } = client(async () => ({
      data: { id: "re_123" },
      error: null,
      headers: null,
    }));
    const gateway = new ResendEmailGateway(
      resend,
      "BehyndMe <alertes@behyndme.com>",
    );

    const result = await gateway.send({
      to: "alice@mail.fr",
      content,
      idempotencyKey: "notification-1",
    });

    expect(result).toEqual({ status: "sent", id: "re_123" });
    const [payload, options] = send.mock.calls[0] as unknown as [
      Record<string, any>,
      Record<string, any>,
    ];
    expect(payload).toMatchObject({
      from: "BehyndMe <alertes@behyndme.com>",
      to: "alice@mail.fr",
      subject: content.subject,
      attachments: [
        {
          filename: "behyndme.png",
          content: LOGO_PNG_BASE64,
          contentType: "image/png",
          contentId: "logo",
        },
      ],
    });
    expect(payload.html).toContain('src="cid:logo"');
    expect(payload.text).toContain("Bonjour Alice,");
    expect(options).toEqual({ idempotencyKey: "notification-1" });
  });

  it("tries again when Resend cannot be reached", async () => {
    const { client: resend } = client(() =>
      Promise.reject(new Error("fetch failed")),
    );
    const gateway = new ResendEmailGateway(resend, "BehyndMe <a@b.c>");
    await expect(
      gateway.send({ to: "a@mail.fr", content, idempotencyKey: "k" }),
    ).resolves.toEqual({ status: "retry", error: "Resend: fetch failed" });
  });

  it("passes on Resend's answer when it refuses", async () => {
    const { client: resend } = client(async () => ({
      data: null,
      error: {
        name: "daily_quota_exceeded",
        message: "You have reached your daily quota",
        statusCode: 429,
      },
      headers: null,
    }));
    const gateway = new ResendEmailGateway(resend, "BehyndMe <a@b.c>");
    await expect(
      gateway.send({ to: "a@mail.fr", content, idempotencyKey: "k" }),
    ).resolves.toEqual({
      status: "quota",
      error: "daily_quota_exceeded: You have reached your daily quota",
    });
  });
});

describe("interpretError", () => {
  it.each([
    ["daily_quota_exceeded", 429, "quota"],
    ["monthly_quota_exceeded", 429, "quota"],
    ["rate_limit_exceeded", 429, "rate_limited"],
    ["concurrent_idempotent_requests", 409, "rate_limited"],
    ["validation_error", 422, "rejected"],
    ["validation_error", 403, "misconfigured"],
    ["invalid_idempotent_request", 409, "rejected"],
    ["invalid_api_key", 403, "misconfigured"],
    ["invalid_from_address", 422, "misconfigured"],
    ["application_error", 500, "retry"],
    ["internal_server_error", 500, "retry"],
  ])("%s (%i): %s", (name, statusCode, status) => {
    expect(interpretError({ name, statusCode, message: "m" }).status).toBe(
      status,
    );
  });
});

describe("disabledEmailGateway", () => {
  it("is off, and refuses to send", async () => {
    expect(disabledEmailGateway.enabled).toBe(false);
    await expect(
      disabledEmailGateway.send({
        to: "a@mail.fr",
        content,
        idempotencyKey: "k",
      }),
    ).rejects.toThrow("E-mail is not configured");
  });
});
