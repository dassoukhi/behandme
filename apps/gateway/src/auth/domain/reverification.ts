// Clerk reverification, checked on the verified session token's `fva` claim.

/**
 * Minutes since the session last verified its first and second factor (Clerk's `fva` claim), -1 for a
 * factor never verified (no MFA).
 */
export type FactorVerificationAge = [number, number];

/**
 * Clerk's "strict" reverification: the second factor verified less than 10 minutes ago, or the first
 * one for an account without MFA. Same rule as Clerk's own check (keys.spec.ts compares them). Asked
 * before what a stolen session must not be enough for: resetting keys, deleting the account.
 */
export const RESET_REVERIFICATION = {
  level: "second_factor",
  afterMinutes: 10,
} as const;

export function recentlyVerified(
  fva: FactorVerificationAge | null | undefined,
): boolean {
  if (!Array.isArray(fva) || fva.length !== 2) return false;
  const [first, second] = fva;
  const recent = (age: number) =>
    age !== -1 && age < RESET_REVERIFICATION.afterMinutes;
  return second !== -1 ? recent(second) : recent(first);
}

/** The session must verify again (Clerk reverification) before this action. */
export class ReverificationRequired extends Error {
  constructor() {
    super("Verify your identity again first");
    this.name = "ReverificationRequired";
  }
}
