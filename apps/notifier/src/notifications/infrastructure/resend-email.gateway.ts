import type { Resend } from "resend";
import type {
  EmailGateway,
  EmailSendResult,
  OutgoingEmail,
} from "../application/ports.js";
import { LOGO_CONTENT_ID, renderEmail } from "./email/BehyndmeEmail.js";
import { LOGO_PNG_BASE64 } from "./email/logo.js";

/** The part of the Resend client the gateway uses. */
export type ResendClient = Pick<Resend, "emails">;

/** Sends the e-mails through Resend, the logo inline (`cid:logo`). */
export class ResendEmailGateway implements EmailGateway {
  readonly enabled = true;

  constructor(
    private readonly client: ResendClient,
    /** "BehyndMe <alertes@behyndme.com>": its domain must be verified at Resend. */
    private readonly from: string,
  ) {}

  async send({
    to,
    content,
    idempotencyKey,
  }: OutgoingEmail): Promise<EmailSendResult> {
    const email = renderEmail(content);
    let response: Awaited<ReturnType<ResendClient["emails"]["send"]>>;
    try {
      response = await this.client.emails.send(
        {
          from: this.from,
          to,
          subject: email.subject,
          html: email.html,
          text: email.text,
          attachments: [
            {
              filename: "behyndme.png",
              content: LOGO_PNG_BASE64,
              contentType: "image/png",
              contentId: LOGO_CONTENT_ID,
            },
          ],
        },
        { idempotencyKey },
      );
    } catch (error) {
      return { status: "retry", error: `Resend: ${(error as Error).message}` };
    }
    if (response.error) return interpretError(response.error);
    return { status: "sent", id: response.data?.id ?? null };
  }
}

/** What to do after an error Resend answered (https://resend.com/docs/api-reference/errors). */
export function interpretError(error: {
  name: string;
  message: string;
  statusCode: number | null;
}): EmailSendResult {
  const detail = `${error.name}: ${error.message}`;
  switch (error.name) {
    case "daily_quota_exceeded":
    case "monthly_quota_exceeded":
      return { status: "quota", error: detail };
    case "rate_limit_exceeded":
    case "concurrent_idempotent_requests":
      return { status: "rate_limited", error: detail };
    case "missing_api_key":
    case "invalid_api_key":
    case "restricted_api_key":
    case "invalid_from_address":
    case "invalid_access":
    case "invalid_region":
    case "security_error":
      return { status: "misconfigured", error: detail };
    case "validation_error":
      // 403: the domain is not verified yet, or the account may only send to its owner (test mode).
      return error.statusCode === 403
        ? { status: "misconfigured", error: detail }
        : { status: "rejected", error: detail };
    case "invalid_parameter":
    case "invalid_attachment":
    case "missing_required_field":
    case "invalid_idempotency_key":
    case "invalid_idempotent_request":
      return { status: "rejected", error: detail };
    default:
      // Resend down, or an error it added since: worth a few more tries.
      return { status: "retry", error: detail };
  }
}

/** Without RESEND_API_KEY: e-mail is off, nothing is queued. */
export const disabledEmailGateway: EmailGateway = {
  enabled: false,
  send: () => Promise.reject(new Error("E-mail is not configured")),
};
