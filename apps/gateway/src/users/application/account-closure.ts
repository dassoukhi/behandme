import type { ContractRecord } from "@lib/contracts";
import type { Profile } from "../domain/profile.js";

/**
 * What closing an account does to the envelopes (contracts) it takes part in: what support tells heirs before closing
 * an account at their request, as the help page and the privacy policy promise. Handover applies it on user.deleted
 * (handover-events.ts): drafts deleted, sealed contracts revoked, released ones left to their accessor, owners told
 * when a participant leaves.
 */
export interface ClosureSummary {
  /** Their drafts: deleted. */
  drafts: number;
  /** Their contracts sealed and not handed over yet: revoked, nobody can ever open them. */
  revoked: number;
  /** Among those, the ones with a claim in progress: the claim ends with the revocation. */
  claimsInProgress: number;
  /** Their contracts already handed over: they stay with their accessor. */
  handedOver: number;
  /** Other people's contracts not handed over yet, where they are the accessor or a validator: the owners are told. */
  participations: number;
}

export function closureSummary(records: ContractRecord[]): ClosureSummary {
  const owned = records.filter((r) => r.my_role === "owner");
  const sealed = owned.filter(
    (r) => r.status === "active" || r.status === "claimed",
  );
  return {
    drafts: owned.filter((r) => r.status === "draft").length,
    revoked: sealed.length,
    claimsInProgress: sealed.filter((r) => r.status === "claimed").length,
    handedOver: owned.filter((r) => r.status === "released").length,
    participations: records.filter(
      (r) =>
        r.my_role !== "owner" &&
        (r.status === "active" || r.status === "claimed"),
    ).length,
  };
}

/** The dry run's report, for support (English, like the rest of the server's tooling). */
export function describeClosure(
  profile: Pick<Profile, "id" | "email" | "first_name" | "last_name">,
  summary: ClosureSummary,
): string[] {
  const name =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
    "(no name)";
  return [
    `Account ${profile.id}: ${name} <${profile.email ?? "no e-mail"}>`,
    `- ${summary.revoked} envelope(s) of theirs not handed over yet: revoked, nobody will ever open them` +
      (summary.claimsInProgress
        ? ` (${summary.claimsInProgress} with a handover request in progress)`
        : ""),
    `- ${summary.drafts} draft(s): deleted`,
    `- ${summary.handedOver} envelope(s) already handed over: they stay with their recipient`,
    `- ${summary.participations} envelope(s) of other people where they are the recipient or a validator: the owners are told`,
    "- Then the profile, keys, contacts, notifications and the Clerk account are deleted.",
  ];
}
