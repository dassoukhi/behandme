import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import {
  type KeyBackupSubmission,
  keyBackupStatement,
} from "../domain/backup.js";
import { keyProofStatement } from "../domain/care.js";
import { type KeySubmission, registrationStatement } from "../domain/keys.js";
import { nodeKeyCryptography } from "../infrastructure/node-key-cryptography.js";

/** A key pair made here (node:crypto) and its submission, signed for `userId` and `keyVersion`. */
export function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signing = new Uint8Array(
    publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  );
  const kem = new Uint8Array(randomBytes(1216));
  const submit = (userId: string, keyVersion: number): KeySubmission => {
    const statement = nodeKeyCryptography.canonicalJson(
      registrationStatement(
        userId,
        keyVersion,
        Buffer.from(kem).toString("base64"),
        Buffer.from(signing).toString("base64"),
      ),
    );
    return {
      keyVersion,
      kemPublicKey: kem,
      signingPublicKey: signing,
      signature: new Uint8Array(sign(null, statement, privateKey)),
    };
  };
  const prove = (userId: string, keyVersion: number, day: string) => ({
    keyVersion,
    day,
    signature: new Uint8Array(
      sign(
        null,
        nodeKeyCryptography.canonicalJson(
          keyProofStatement(userId, keyVersion, day),
        ),
        privateKey,
      ),
    ),
  });
  /** A passkey backup of these keys, as the phone signs it (the box is whatever the test passes). */
  const backUp = (
    userId: string,
    keyVersion: number,
    backup: {
      credentialId: string;
      box: Uint8Array;
      madeAt: string;
      synced?: boolean;
    },
  ): KeyBackupSubmission => {
    const { credentialId, box, madeAt, synced = true } = backup;
    return {
      keyVersion,
      credentialId,
      synced,
      madeAt,
      box,
      signature: new Uint8Array(
        sign(
          null,
          nodeKeyCryptography.canonicalJson(
            keyBackupStatement(
              userId,
              keyVersion,
              credentialId,
              synced,
              madeAt,
              nodeKeyCryptography.sha256Hex(box),
            ),
          ),
          privateKey,
        ),
      ),
    };
  };
  return Object.assign(submit, { prove, backUp });
}
