import type { UserProfileDto } from "../users/dto/user-profile.dto.js";
import { projectProfile } from "../users/profile-visibility.js";

export type ContractRole = "owner" | "accessor" | "validator";

interface ContractParticipants {
  owner_id?: string | null;
  accessor_id?: string | null;
  validators?: string[] | null;
}

/** The caller's role on a contract, or null when they may not see it. */
export function contractRole(
  contract: ContractParticipants,
  me: string,
): ContractRole | null {
  if (contract.owner_id === me) return "owner";
  if (contract.accessor_id === me) return "accessor";
  if (contract.validators?.includes(me)) return "validator";
  return null;
}

/** PostgREST filter matching contracts the caller participates in. `me` is a validated Clerk id. */
export function participantFilter(me: string): string {
  return `owner_id.eq.${me},accessor_id.eq.${me},validators.cs.{${me}}`;
}

type ContractView = ContractParticipants & {
  owner?: UserProfileDto | null;
  accessor?: UserProfileDto | null;
  validators_list?: UserProfileDto[];
};

/** Shapes a contract for the caller: joined profiles follow the profile visibility rule. */
export function projectContract<T extends ContractView>(
  contract: T,
  me: string,
  trustingMe: Set<string>,
): T {
  const view = { ...contract };
  const profile = (user: UserProfileDto) =>
    projectProfile(user, me, trustingMe.has(user.id));
  if (view.owner) view.owner = profile(view.owner);
  if (view.accessor) view.accessor = profile(view.accessor);
  if (view.validators_list)
    view.validators_list = view.validators_list.map(profile);
  return view;
}

/** IDs of every profile joined on the given contracts. */
export function joinedProfileIds(contracts: ContractView[]): string[] {
  const ids = new Set<string>();
  for (const c of contracts) {
    if (c.owner) ids.add(c.owner.id);
    if (c.accessor) ids.add(c.accessor.id);
    c.validators_list?.forEach((v) => ids.add(v.id));
  }
  return [...ids];
}
