import { AuditVerifyDue, PushReceiptsDue, RetentionDue } from "@lib/contracts";
import type { NewEvent } from "@lib/messaging";
import { DAY, MINUTE } from "../domain/schedule.js";

/** A recurring job: once per period, the worker publishes an event that the owning service handles. */
export interface ScheduledJob {
  name: string;
  everyMs: number;
  event: () => NewEvent;
}

export const JOBS: ScheduledJob[] = [
  // Expo publishes push receipts within 15 minutes (notifier).
  {
    name: "push-receipts",
    everyMs: 15 * MINUTE,
    event: () => PushReceiptsDue.create({}),
  },
  // Handover checks the hash chain of every contract's audit log.
  {
    name: "audit-verify",
    everyMs: DAY,
    event: () => AuditVerifyDue.create({}),
  },
  // Each service deletes what it no longer needs.
  { name: "retention", everyMs: DAY, event: () => RetentionDue.create({}) },
];
