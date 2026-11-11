import { Inject, Injectable } from "@nestjs/common";
import { KeyCareReminder } from "@lib/contracts";
import {
  type Clock,
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from "@lib/kernel";
import {
  acceptableProofDay,
  careReminder,
  type KeyCare,
  keyProofStatement,
  phraseCheckDue,
  type PhraseLocation,
  phraseScheduleDue,
  utcDay,
  type ValidatorKeyState,
  validatorKeyState,
} from "../domain/care.js";
import { SIGNATURE_LENGTH } from "../domain/keys.js";
import { KEYS_CLOCK } from "./keys.service.js";
import {
  KEY_CRYPTOGRAPHY,
  KEY_REPOSITORY,
  type KeyCryptography,
  type KeyRepository,
  type KeysTransaction,
} from "./ports.js";

const CARE_PAGE = 500;
/** Keeps the job's transaction short, well within the queue's visibility; the rest waits for tomorrow. */
const MAX_REMINDERS_PER_RUN = 1_000;

/** A user's own view of the care of their keys, as the API returns it. */
export interface KeyCareView {
  proven_on: string | null;
  phrase_checked_at: string | null;
  phrase_check_due: boolean;
  phrase_location: PhraseLocation | null;
  passkey_backup: {
    credential_id: string;
    synced: boolean;
    made_at: string;
  } | null;
}

/** Keys just registered: nothing is known about them yet. */
export const NO_KEY_CARE: KeyCareView = {
  proven_on: null,
  phrase_checked_at: null,
  phrase_check_due: false,
  phrase_location: null,
  passkey_backup: null,
};

/** Whether users still hold their keys: the phone's proofs, the checks of the phrase, the reminders. */
@Injectable()
export class KeyCareService {
  constructor(
    @Inject(KEY_REPOSITORY) private readonly keys: KeyRepository,
    @Inject(KEY_CRYPTOGRAPHY) private readonly crypto: KeyCryptography,
    @Inject(KEYS_CLOCK) private readonly clock: Clock,
  ) {}

  async mine(me: string): Promise<KeyCareView> {
    const [care] = await this.keys.careOf([me]);
    if (!care) throw new NotFoundError("No keys registered yet");
    return {
      proven_on: care.provenOn ? utcDay(care.provenOn) : null,
      phrase_checked_at: care.phraseCheckedAt?.toISOString() ?? null,
      phrase_check_due: phraseCheckDue(care, this.clock.now()),
      phrase_location: care.phraseLocation,
      passkey_backup: care.passkeyBackup && {
        credential_id: care.passkeyBackup.credentialId,
        synced: care.passkeyBackup.synced,
        made_at: care.passkeyBackup.madeAt.toISOString(),
      },
    };
  }

  /** The phone signed today's date with the registered keys: it still holds them. */
  async prove(
    me: string,
    proof: { keyVersion: number; day: string; signature: Uint8Array },
  ): Promise<void> {
    if (!acceptableProofDay(proof.day, this.clock.now())) {
      throw new InvalidInputError("The proof's day is not today");
    }
    if (proof.signature.length !== SIGNATURE_LENGTH) {
      throw new InvalidInputError(
        "signature must be an Ed25519 signature (64 bytes)",
      );
    }
    const keys = await this.keys.find(me);
    if (!keys) throw new NotFoundError("No keys registered yet");
    if (keys.keyVersion !== proof.keyVersion) {
      throw new ConflictError("The keys changed meanwhile");
    }
    const statement = this.crypto.canonicalJson(
      keyProofStatement(me, proof.keyVersion, proof.day),
    );
    if (
      !this.crypto.verifyEd25519(
        keys.signingPublicKey,
        statement,
        proof.signature,
      )
    ) {
      throw new InvalidInputError("The proof's signature does not verify");
    }
    const day = new Date(`${proof.day}T00:00:00Z`);
    if (!(await this.keys.recordProof(me, proof.keyVersion, day))) {
      throw new ConflictError("The keys changed meanwhile");
    }
  }

  /** What the user says: they just proved they kept their phrase, and where they keep it. */
  async updatePhrase(
    me: string,
    change: {
      keyVersion: number;
      checked?: boolean;
      location?: PhraseLocation;
    },
  ): Promise<void> {
    if (!change.checked && !change.location) {
      throw new InvalidInputError("Nothing to change");
    }
    const [care] = await this.keys.careOf([me]);
    if (!care) throw new NotFoundError("No keys registered yet");
    const now = this.clock.now();
    const updated = await this.keys.updateCare(me, change.keyVersion, {
      ...(change.checked
        ? {
            checkedAt: now,
            countCheck: !care.phraseCheckedAt || phraseScheduleDue(care, now),
          }
        : {}),
      ...(change.location ? { location: change.location } : {}),
    });
    if (!updated) throw new ConflictError("The keys changed meanwhile");
  }

  /** For the contracts facade: how far an owner can count on those who hold a share of their contract. */
  async validatorStates(
    ids: string[],
  ): Promise<
    (validator: { user_id: string; fingerprint: string }) => ValidatorKeyState
  > {
    const care = await this.keys.careOf([...new Set(ids)]);
    const careOf = new Map(care.map((c) => [c.userId, c]));
    const now = this.clock.now();
    return ({ user_id, fingerprint }) =>
      validatorKeyState(fingerprint, careOf.get(user_id), now);
  }

  /** The daily job, inside the transaction that handles its message. Returns how many were reminded. */
  async remind(tx: KeysTransaction): Promise<number> {
    const now = this.clock.now();
    let after: string | null = null;
    let reminded = 0;
    for (;;) {
      const page: KeyCare[] = await tx.keys.carePage(after, CARE_PAGE);
      const due = page.flatMap((care) => {
        const kind = careReminder(care, now);
        return kind ? [{ userId: care.userId, kind }] : [];
      });
      for (const reminder of due) {
        await tx.events.publish(KeyCareReminder.create(reminder));
      }
      await tx.keys.markReminded(
        due.map((reminder) => reminder.userId),
        now,
      );
      reminded += due.length;
      if (page.length < CARE_PAGE || reminded >= MAX_REMINDERS_PER_RUN) {
        return reminded;
      }
      after = page[page.length - 1].userId;
    }
  }
}
