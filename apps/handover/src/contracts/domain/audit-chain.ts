// The audit log of a contract is a hash chain. Message of an event (UTF-8, fields joined by "\n"):
//   prev_hash, seq, occurred_at, contract_id, type, actor_id ("" for the system), body
// hash = lowercase hex SHA-256 of it; the first event's prev_hash is 64 zeros. Computed by the
// database (handover.append_event) and checked here and in the app (lib/audit/verifyChain.ts).

export const GENESIS_HASH = "0".repeat(64);

export interface ChainEvent {
  contract_id: string;
  seq: number;
  type: string;
  actor_id: string | null;
  body: string;
  occurred_at: string;
  prev_hash: string;
  hash: string;
}

export function chainMessage(event: ChainEvent): string {
  return [
    event.prev_hash,
    String(event.seq),
    event.occurred_at,
    event.contract_id,
    event.type,
    event.actor_id ?? "",
    event.body,
  ].join("\n");
}

export interface ChainCheck {
  ok: boolean;
  length: number;
  headHash: string | null;
  /** First seq that does not verify. */
  brokenAt: number | null;
}

/**
 * Checks a contract's whole log, in seq order: numbering from 1 without gaps, each event linked to
 * the previous hash, each hash matching its content.
 */
export function verifyChain(
  contractId: string,
  events: ChainEvent[],
  sha256Hex: (text: string) => string,
): ChainCheck {
  let previous = GENESIS_HASH;
  for (const [index, event] of events.entries()) {
    const intact =
      event.contract_id === contractId &&
      event.seq === index + 1 &&
      event.prev_hash === previous &&
      event.hash === sha256Hex(chainMessage(event));
    if (!intact) {
      return {
        ok: false,
        length: events.length,
        headHash: events.at(-1)?.hash ?? null,
        brokenAt: index + 1,
      };
    }
    previous = event.hash;
  }
  return {
    ok: true,
    length: events.length,
    headHash: events.at(-1)?.hash ?? null,
    brokenAt: null,
  };
}
