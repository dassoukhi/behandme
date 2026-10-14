import type { PushGateway } from "../application/ports.js";
import type { PushMessage, PushOutcome } from "../domain/push.js";

/** Expo stand-in: records what is sent, answers with scripted outcomes (ok with a ticket by default). */
export class FakePush implements PushGateway {
  sent: (PushMessage & { to: string })[] = [];
  /** Outcome per token; default ok. */
  outcomes = new Map<string, PushOutcome>();
  receiptsByTicket = new Map<string, PushOutcome>();
  failWith: Error | null = null;
  private tickets = 0;

  async send(
    messages: (PushMessage & { to: string })[],
  ): Promise<PushOutcome[]> {
    if (this.failWith) throw this.failWith;
    this.sent.push(...messages);
    return messages.map(
      (m) =>
        this.outcomes.get(m.to) ?? {
          status: "ok",
          id: `ticket-${++this.tickets}`,
        },
    );
  }

  async receipts(ticketIds: string[]): Promise<Map<string, PushOutcome>> {
    return new Map(
      ticketIds
        .filter((id) => this.receiptsByTicket.has(id))
        .map((id) => [id, this.receiptsByTicket.get(id)!]),
    );
  }
}
