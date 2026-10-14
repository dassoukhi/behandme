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
