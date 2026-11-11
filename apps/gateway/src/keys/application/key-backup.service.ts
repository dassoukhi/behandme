import { Inject, Injectable } from "@nestjs/common";
import { KeysBackupOpened } from "@lib/contracts";
import {
  type Clock,
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from "@lib/kernel";
import {
  assertCredentialId,
  assertWellFormedBackup,
  backupTime,
  type KeyBackupSubmission,
  keyBackupStatement,
} from "../domain/backup.js";
import {
  type FactorVerificationAge,
  recentlyVerified,
  ReverificationRequired,
} from "../domain/keys.js";
import { KEYS_CLOCK } from "./keys.service.js";
import {
  KEY_BACKUP_REPOSITORY,
  KEY_CRYPTOGRAPHY,
  KEYS_UNIT_OF_WORK,
  type KeyBackupRepository,
  type KeyCryptography,
  type KeysUnitOfWork,
} from "./ports.js";

/** The box as the new phone gets it, to open with the passkey's PRF output. */
export interface KeyBackupBox {
  key_version: number;
  credential_id: string;
  box: string;
}

/**
 * The keys backed up in a passkey: the server keeps a box it cannot open. Putting one in needs the keys' signature,
 * of the time; taking it out, or deleting it, a fresh Clerk verification. Taking it out alerts the user. Both read
 * the keys locked, so that a reset meanwhile cannot leave behind, or hand out, a box of the keys it replaced.
 */
@Injectable()
export class KeyBackupService {
  constructor(
    @Inject(KEY_BACKUP_REPOSITORY)
    private readonly backups: KeyBackupRepository,
    @Inject(KEY_CRYPTOGRAPHY) private readonly crypto: KeyCryptography,
    @Inject(KEYS_UNIT_OF_WORK) private readonly unitOfWork: KeysUnitOfWork,
    @Inject(KEYS_CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The phone, once the passkey gave its PRF output: the seed's box, signed by the keys in it. Replaces an older
   * backup, never a newer one.
   */
  async put(me: string, submission: KeyBackupSubmission): Promise<void> {
    assertWellFormedBackup(submission);
    const madeAt = backupTime(submission.madeAt, this.clock.now());
    await this.unitOfWork.run(async ({ keys, backups }) => {
      const current = await keys.findForShare(me);
      if (!current) throw new NotFoundError("No keys registered yet");
      if (current.keyVersion !== submission.keyVersion) {
        throw new ConflictError("The keys changed meanwhile");
      }
      const statement = this.crypto.canonicalJson(
        keyBackupStatement(
          me,
          submission.keyVersion,
          submission.credentialId,
          submission.synced,
          submission.madeAt,
          this.crypto.sha256Hex(submission.box),
        ),
      );
      if (
        !this.crypto.verifyEd25519(
          current.signingPublicKey,
          statement,
          submission.signature,
        )
      ) {
        throw new InvalidInputError("The backup's signature does not verify");
      }
      if (!(await backups.put({ userId: me, ...submission, madeAt }))) {
        throw new ConflictError("A backup made later is already there");
      }
    });
  }

  /**
   * A phone without the keys, once the passkey gave its PRF output: the box. The user is told at once, on their
   * other phones too. The credential id is no secret (GET /users/me/keys shows it): checking it only spares the
   * user an alert when they picked another passkey.
   */
  async open(
    me: string,
    credentialId: string,
    fva: FactorVerificationAge | null,
  ): Promise<KeyBackupBox> {
    if (!recentlyVerified(fva)) throw new ReverificationRequired();
    assertCredentialId(credentialId);
    return this.unitOfWork.run(async ({ keys, backups, events }) => {
      const current = await keys.findForShare(me);
      const backup = await backups.find(me);
      if (!current || !backup || backup.keyVersion !== current.keyVersion) {
        throw new NotFoundError("No backup of the account's keys");
      }
      if (backup.credentialId !== credentialId) {
        throw new ConflictError("This passkey does not hold the backup");
      }
      await events.publish(KeysBackupOpened.create({ userId: me }));
      return {
        key_version: backup.keyVersion,
        credential_id: backup.credentialId,
        box: this.crypto.toBase64(backup.box),
      };
    });
  }

  async remove(me: string, fva: FactorVerificationAge | null): Promise<void> {
    if (!recentlyVerified(fva)) throw new ReverificationRequired();
    if (!(await this.backups.deleteForUser(me))) {
      throw new NotFoundError("No backup");
    }
  }
}
