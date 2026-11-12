import type { PersonName } from "../domain/email.js";

// Made-up people and values for the e-mail previews and their tests. The recipient is Alex; Camille owns
// the contract, Léa is its accessor and asks for the handover.

export const PEOPLE = new Map<string, PersonName>([
  ["user_alex", { firstName: "Alex", lastName: "Bernard" }],
  ["user_camille", { firstName: "Camille", lastName: "Martin" }],
  ["user_lea", { firstName: "Léa", lastName: "Petit" }],
]);

export const OCCURRED_AT = "2026-11-12T13:30:00.000Z";

/** One parameter set that fits every template; whoever the template writes to, it is Alex. */
export const SAMPLE = {
  userId: "user_alex",
  ownerId: "user_camille",
  validatorId: "user_alex",
  accessorId: "user_alex",
  trusterId: "user_alex",
  claimantId: "user_lea",
  contractId: "contract_1",
  ownerName: "Camille Martin",
  userName: "Camille Martin",
  category: "networks",
  quorum: true,
  reason: "withdrawn",
  role: "validator",
  contestUntil: "2026-11-19T13:30:00.000Z",
  usableFrom: "2026-11-15T13:30:00.000Z",
};
