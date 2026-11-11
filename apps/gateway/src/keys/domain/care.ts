// How we know, while something can still be done, that a user's end-to-end keys are not lost: the phone
// proves now and then that it holds them, and the user proves that they kept their recovery phrase, or keeps
// the keys in a passkey that syncs. The app's docs/crypto-protocol.md ("Key care") describes the signature.

const DAY_MS = 86_400_000;

/** Days until the check that follows each of the first proofs; then the yearly check-up takes over. */
const FIRST_CHECKS_DAYS = [7, 30, 180];
/** The yearly check-up leaves at least this long since the last proof, or the last phone sign. */
const MIN_GAP_DAYS = 30;
/** 13 months: a whole yearly cycle, with its reminders, went by without a sign from the phone. */
export const SILENT_AFTER_DAYS = 396;

export const PHRASE_LOCATIONS = [
  "papers",
  "safe",
  "password_manager",
  "relative",
  "notary",
  "other",
] as const;
export type PhraseLocation = (typeof PHRASE_LOCATIONS)[number];

export const VALIDATOR_KEY_STATES = [
  "ok",
  "lost",
  "not_saved",
  "silent",
] as const;
export type ValidatorKeyState = (typeof VALIDATOR_KEY_STATES)[number];

export type CareReminderKind = "phrase_check" | "key_checkup";

export interface KeyCare {
  userId: string;
  keyVersion: number;
  fingerprint: string;
  createdAt: Date;
  /** Midnight UTC of the day the phone last proved it holds the keys. */
  provenOn: Date | null;
  /** Null until the user proves they kept their phrase. */
  phraseCheckedAt: Date | null;
  phraseChecks: number;
  phraseLocation: PhraseLocation | null;
  remindedAt: Date | null;
  /** The backup of these keys in a passkey, if any (domain/backup.ts). */
  passkeyBackup: {
    credentialId: string;
    synced: boolean;
    /** When the phone made the backup or last confirmed that the passkey opens it (signed). */
    madeAt: Date;
  } | null;
}

/**
 * A passkey that syncs holds these keys: losing the phone loses nothing, and the phrase is only a fallback. Only
 * for 13 months after the phone last confirmed it: the passkey may have been deleted since, or the keychain turned
 * off, which the server cannot see.
 */
export function backedUpByPasskey(care: KeyCare, now: Date): boolean {
  const backup = care.passkeyBackup;
  return (
    backup?.synced === true &&
    now.getTime() - backup.madeAt.getTime() <= SILENT_AFTER_DAYS * DAY_MS
  );
}

/** A UTC day, as the phone signs it. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** What the phone signs to prove it holds the keys (canonical JSON, RFC 8785). */
export function keyProofStatement(
  userId: string,
  keyVersion: number,
  day: string,
) {
  return {
    type: "behyndme/v1/key-proof",
    user_id: userId,
    key_version: keyVersion,
    day,
  };
}

/** A real day, within a day of the server's: the phone's clock and time zone may differ a little. */
export function acceptableProofDay(day: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime()) || utcDay(at) !== day) return false;
  const today = new Date(`${utcDay(now)}T00:00:00Z`);
  return Math.abs(at.getTime() - today.getTime()) <= DAY_MS;
}

/** The last sign of life of these keys: the phone's last proof, or the day they were made. */
const lastSign = (care: KeyCare) => care.provenOn ?? care.createdAt;

/** When the next check of the phrase falls in its schedule; null until the user proved they kept it. */
export function phraseScheduleDueAt(care: KeyCare): Date | null {
  if (!care.phraseCheckedAt) return null;
  const last = care.phraseCheckedAt.getTime();
  const days = FIRST_CHECKS_DAYS[care.phraseChecks - 1];
  if (days !== undefined) return new Date(last + days * DAY_MS);
  const nextJanuary = Date.UTC(care.phraseCheckedAt.getUTCFullYear() + 1, 0, 1);
  return new Date(Math.max(nextJanuary, last + MIN_GAP_DAYS * DAY_MS));
}

/** A check made now is the next step of the schedule, whether it was asked for or not. */
export function phraseScheduleDue(care: KeyCare, now: Date): boolean {
  const due = phraseScheduleDueAt(care);
  return due !== null && due <= now;
}

/** When the user is asked to check the phrase: never while a passkey that syncs holds the keys, a fallback then. */
export function phraseCheckDueAt(care: KeyCare, now: Date): Date | null {
  return backedUpByPasskey(care, now) ? null : phraseScheduleDueAt(care);
}

export function phraseCheckDue(care: KeyCare, now: Date): boolean {
  const due = phraseCheckDueAt(care, now);
  return due !== null && due <= now;
}

/** The check-up's two reminders: the start of each half of January, a date people put things in order. */
function checkupSlot(now: Date): Date | null {
  if (now.getUTCMonth() !== 0) return null;
  const day = now.getUTCDate() <= 15 ? 1 : 16;
  return new Date(Date.UTC(now.getUTCFullYear(), 0, day));
}

/**
 * The reminder this user is due now, if any: one when a check of the phrase falls due, then, while it stays
 * overdue, again each January; two at most for the yearly check-up.
 */
export function careReminder(
  care: KeyCare,
  now: Date,
): CareReminderKind | null {
  const slot = checkupSlot(now);
  const sign = lastSign(care).getTime();
  if (
    slot &&
    sign < Date.UTC(now.getUTCFullYear(), 0, 1) &&
    now.getTime() - sign >= MIN_GAP_DAYS * DAY_MS &&
    (!care.remindedAt || care.remindedAt < slot)
  ) {
    return "key_checkup";
  }
  const due = phraseCheckDueAt(care, now);
  if (!due || due > now) return null;
  const askedSince = slot && slot > due ? slot : due;
  return !care.remindedAt || care.remindedAt < askedSince
    ? "phrase_check"
    : null;
}

/** Whether the owner can count on a validator: worst first, a lost share over a silent phone. */
export function validatorKeyState(
  sealedFingerprint: string,
  care: KeyCare | undefined,
  now: Date,
): ValidatorKeyState {
  if (!care || care.fingerprint !== sealedFingerprint) return "lost";
  if (now.getTime() - lastSign(care).getTime() > SILENT_AFTER_DAYS * DAY_MS) {
    return "silent";
  }
  return care.phraseCheckedAt || backedUpByPasskey(care, now)
    ? "ok"
    : "not_saved";
}
