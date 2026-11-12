import type {
  EmailGateway,
  EmailSendResult,
  OutgoingEmail,
} from "../application/ports.js";

/** Records the e-mails sent; `next` sets what the provider answers to the coming ones. */
export class FakeEmail implements EmailGateway {
  enabled = true;
  readonly sent: OutgoingEmail[] = [];
  /** Answers for the next sends, in order; then every send succeeds. */
  next: EmailSendResult[] = [];

  async send(email: OutgoingEmail): Promise<EmailSendResult> {
    this.sent.push(email);
    return (
      this.next.shift() ?? {
        status: "sent",
        id: `email-${this.sent.length}`,
      }
    );
  }
}
