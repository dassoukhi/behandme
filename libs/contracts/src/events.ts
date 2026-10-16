import { z } from "zod";
import { defineEvent } from "./event-definition.js";

// Events exchanged between services. Routing (which queue receives which type) is in the
// messaging.subscriptions table (supabase/migrations). Changing a payload means a new version.

const userId = z.string().min(1);

/** Gateway: `ownerId` now trusts `trustedId`. */
export const TrustAdded = defineEvent(
  "trust.added",
  1,
  z.object({
    ownerId: userId,
    trustedId: userId,
    /** How the owner is shown to the person they added; null when they have no name. */
    ownerName: z.string().min(1).nullable(),
  }),
);

/**
 * Gateway: `userId` replaced their end-to-end keys (lost or compromised). Others may encrypt to the new
 * keys from `usableFrom`, after a quarantine that leaves time to react if it was not them.
 */
export const KeysRotated = defineEvent(
  "keys.rotated",
  1,
  z.object({
    userId,
    keyVersion: z.number().int().min(2),
    usableFrom: z.iso.datetime(),
    /** How the user is shown to others; null when they have no name. */
    userName: z.string().min(1).nullable(),
    /** The people who trust the user: they may encrypt to them, and should compare the new code. */
    trusterIds: z.array(userId),
  }),
);

const contractId = z.uuid();
const claimId = z.uuid();
const category = z.enum(["networks", "devices", "storage"]);

/** Handover: someone asks for the release of a contract; the owner may cancel until `contestUntil`. */
export const ClaimFiled = defineEvent(
  "claim.filed",
  1,
  z.object({
    contractId,
    claimId,
    category,
    ownerId: userId,
    claimantId: userId,
    validatorIds: z.array(userId),
    contestUntil: z.iso.datetime(),
  }),
);

/** Handover: enough validators approved; the release follows at `contestUntil` unless cancelled. */
export const ClaimQuorumReached = defineEvent(
  "claim.quorum_reached",
  1,
  z.object({
    contractId,
    claimId,
    category,
    ownerId: userId,
    contestUntil: z.iso.datetime(),
  }),
);

/** Handover: a claim ended without release. */
export const ClaimClosed = defineEvent(
  "claim.closed",
  1,
  z.object({
    contractId,
    claimId,
    category,
    reason: z.enum([
      "cancelled",
      "withdrawn",
      "rejected",
      "expired",
      "revoked",
      "participant_left",
    ]),
    /** Who closed it; null for the system (rejection count, expiry, departure). */
    closedBy: userId.nullable(),
    ownerId: userId,
    claimantId: userId,
    validatorIds: z.array(userId),
  }),
);

/** Handover: the contract is released; the accessor can open it. */
export const ContractReleased = defineEvent(
  "contract.released",
  1,
  z.object({
    contractId,
    claimId,
    category,
    ownerId: userId,
    accessorId: userId,
    validatorIds: z.array(userId),
  }),
);

/** Handover: nobody can open the contract any more (the owner revoked it or deleted their account). */
export const ContractRevoked = defineEvent(
  "contract.revoked",
  1,
  z.object({
    contractId,
    category,
    reason: z.enum(["owner", "account_deleted"]),
    ownerId: userId,
    accessorId: userId,
    validatorIds: z.array(userId),
  }),
);

/** Handover: a participant deleted their account; the owner should re-seal with someone else. */
export const ParticipantLeft = defineEvent(
  "participant.left",
  1,
  z.object({
    contractId,
    category,
    ownerId: userId,
    role: z.enum(["accessor", "validator"]),
  }),
);

/** Handover to itself, delayed to the end of the contest window: release if the quorum is there. */
export const ClaimDeadlineDue = defineEvent(
  "claim.deadline_due",
  1,
  z.object({ contractId, claimId }),
);

/** Handover to itself, delayed to a day before the end of the contest window: remind who has not acted. */
export const ClaimReminderDue = defineEvent(
  "claim.reminder_due",
  1,
  z.object({ contractId, claimId }),
);

/** Handover: the contest window ends soon; the owner may still cancel, some validators have not decided. */
export const ClaimReminder = defineEvent(
  "claim.reminder",
  1,
  z.object({
    contractId,
    claimId,
    category,
    ownerId: userId,
    /** Validators who have not decided yet (the claimant excluded). */
    pendingValidatorIds: z.array(userId),
    /** Enough approvals already: without a cancel, the release follows at the end of the window. */
    quorum: z.boolean(),
    contestUntil: z.iso.datetime(),
  }),
);

/** Worker, hourly: handover settles every open claim past its deadline (catch-up for lost messages). */
export const ClaimsDue = defineEvent("maintenance.claims_due", 1, z.object({}));

/** Gateway: the profile is gone; every service forgets the user's data. */
export const UserDeleted = defineEvent("user.deleted", 1, z.object({ userId }));

/** pg_cron (ops.send_tick), every minute, to the worker. */
export const SchedulerTick = defineEvent("scheduler.tick", 1, z.object({}));

/** Worker: time to check the receipts of the pushes sent. */
export const PushReceiptsDue = defineEvent(
  "maintenance.push_receipts_due",
  1,
  z.object({}),
);

/** Worker, daily: handover checks the hash chain of every contract's audit log. */
export const AuditVerifyDue = defineEvent(
  "maintenance.audit_verify_due",
  1,
  z.object({}),
);

/** Worker, daily: each service deletes the data it no longer needs. */
export const RetentionDue = defineEvent(
  "maintenance.retention_due",
  1,
  z.object({}),
);
