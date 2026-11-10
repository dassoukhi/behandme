import { Inject, Injectable } from "@nestjs/common";
import { KeysTransferred } from "@lib/contracts";
import { type Clock, ConflictError, NotFoundError } from "@lib/kernel";
import {
  type FactorVerificationAge,
  recentlyVerified,
  ReverificationRequired,
} from "../domain/keys.js";
import {
  assertRecipientKey,
  assertTransferWrap,
  isOpen,
  type KeyTransfer,
  TRANSFER_TTL_MS,
} from "../domain/transfer.js";
import { KEYS_CLOCK } from "./keys.service.js";
import {
  KEY_TRANSFER_REPOSITORY,
  KEYS_UNIT_OF_WORK,
  type KeyRepository,
  type KeysUnitOfWork,
  type KeyTransferRepository,
} from "./ports.js";

/** A transfer as either phone sees it: whether the old phone deposited the wrap, never the wrap itself. */
export interface KeyTransferView {
  id: string;
  recipient_key: string;
  key_version: number;
  ready: boolean;
  expires_at: string;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const view = (transfer: KeyTransfer): KeyTransferView => ({
  id: transfer.id,
  recipient_key: b64(transfer.recipientKey),
  key_version: transfer.keyVersion,
  ready: transfer.wrap !== null,
  expires_at: transfer.expiresAt.toISOString(),
});

/**
 * Keys from the old phone to a new one, with no phrase: the server relays a wrap it cannot open, for a few
 * minutes, between two sessions of one account. Opening needs a fresh Clerk verification, so that a stolen
 * session cannot get the old phone to send the keys; taking them alerts the user.
 */
@Injectable()
export class KeyTransferService {
  constructor(
    @Inject(KEY_TRANSFER_REPOSITORY)
    private readonly transfers: KeyTransferRepository,
    @Inject(KEYS_UNIT_OF_WORK) private readonly unitOfWork: KeysUnitOfWork,
    @Inject(KEYS_CLOCK) private readonly clock: Clock,
  ) {}

  /** The new phone: a transfer to the key it just made. Replaces the one the user had. */
  async open(
    me: string,
    recipientKey: Uint8Array,
    fva: FactorVerificationAge | null,
  ): Promise<KeyTransferView> {
    if (!recentlyVerified(fva)) throw new ReverificationRequired();
    assertRecipientKey(recipientKey);
    const now = this.clock.now();
    return this.unitOfWork.run(async ({ keys, transfers }) => {
      const current = await keys.find(me);
      if (!current) {
        throw new NotFoundError("No keys to move: create them instead");
      }
      return view(
        await transfers.open({
          userId: me,
          recipientKey,
          keyVersion: current.keyVersion,
          expiresAt: new Date(now.getTime() + TRANSFER_TTL_MS),
        }),
      );
    });
  }

  /** Either phone: the open transfer, if it is this user's. */
  async find(me: string, id: string): Promise<KeyTransferView> {
    const transfer = await this.transfers.find(id, me);
    return view(this.stillOpen(transfer));
  }

  /** The old phone, after Face ID: the seed, wrapped to the new phone's key. Once. */
  async deposit(
    me: string,
    id: string,
    keyVersion: number,
    wrap: Uint8Array,
  ): Promise<KeyTransferView> {
    assertTransferWrap(wrap);
    return this.unitOfWork.run(async ({ keys, transfers }) => {
      const transfer = this.stillOpen(await transfers.findForUpdate(id, me));
      await this.sameKeys(keys, me, transfer, keyVersion);
      if (transfer.wrap) {
        throw new ConflictError("This transfer holds keys already");
      }
      await transfers.deposit(id, wrap);
      return view({ ...transfer, wrap });
    });
  }

  /** The new phone: the wrap, then nothing is left of the transfer. The user is told. */
  async take(
    me: string,
    id: string,
  ): Promise<{ key_version: number; wrap: string }> {
    return this.unitOfWork.run(async ({ keys, transfers, events }) => {
      const transfer = this.stillOpen(await transfers.findForUpdate(id, me));
      if (!transfer.wrap) {
        throw new ConflictError("The old phone has not sent the keys yet");
      }
      await this.sameKeys(keys, me, transfer, transfer.keyVersion);
      await transfers.delete(id);
      await events.publish(KeysTransferred.create({ userId: me }));
      return { key_version: transfer.keyVersion, wrap: b64(transfer.wrap) };
    });
  }

  private stillOpen(transfer: KeyTransfer | null): KeyTransfer {
    if (!transfer || !isOpen(transfer, this.clock.now())) {
      throw new NotFoundError("No such transfer, or it expired");
    }
    return transfer;
  }

  /** The seed moved must be of the account's current keys: a reset meanwhile makes it worthless. */
  private async sameKeys(
    keys: KeyRepository,
    me: string,
    transfer: KeyTransfer,
    keyVersion: number,
  ): Promise<void> {
    const current = await keys.find(me);
    if (
      current?.keyVersion !== keyVersion ||
      transfer.keyVersion !== keyVersion
    ) {
      throw new ConflictError("The keys changed meanwhile");
    }
  }
}
