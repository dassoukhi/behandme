import type { Executor } from "@lib/messaging";
import type { NotificationDraft, Preferences } from "../domain/notification.js";
import type { PushMessage, PushOutcome } from "../domain/push.js";

export interface StoredNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationRepository {
  /** Stores the drafts; returns them with their ids, in the same order. */
  insert(drafts: NotificationDraft[]): Promise<StoredNotification[]>;
  /** The user's notifications, newest first. */
  list(userId: string, limit: number): Promise<StoredNotification[]>;
  /** Unread count of each of `userIds` (0 when absent). */
  unreadCounts(userIds: string[]): Promise<Map<string, number>>;
  /** Null when the notification is not the user's. */
  setRead(
    userId: string,
    id: string,
    read: boolean,
    now: Date,
  ): Promise<StoredNotification | null>;
  /** Number of notifications marked. */
  markAllRead(userId: string, now: Date): Promise<number>;
  /** False when the notification is not the user's. */
  delete(userId: string, id: string): Promise<boolean>;
  deleteForUser(userId: string): Promise<void>;
  /** Deletes read notifications read before `before`; returns how many. */
  purgeRead(before: Date): Promise<number>;
}

export interface PushTokenRepository {
  /** The device now belongs to `userId`, whoever had it before. */
  register(userId: string, token: string): Promise<void>;
  /** Only removes the token if it belongs to `userId`. */
  unregister(userId: string, token: string): Promise<void>;
  /** Tokens of each of `userIds`. */
  tokensOf(userIds: string[]): Promise<Map<string, string[]>>;
  /** Forgets devices that no longer exist. */
  remove(tokens: string[]): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
}

export interface PreferenceRepository {
  /** Settings of each of `userIds`; defaults for users who never changed them. */
  getMany(userIds: string[]): Promise<Map<string, Preferences>>;
  update(userId: string, changes: Partial<Preferences>): Promise<Preferences>;
  deleteForUser(userId: string): Promise<void>;
}

export interface Delivery {
  id: string;
  token: string;
  message: PushMessage;
  attempts: number;
  ticket_id: string | null;
  sent_at: Date | null;
}

export interface DeliveryRepository {
  /** New pending deliveries, due at `now`. */
  enqueue(
    deliveries: {
      notificationId: string;
      token: string;
      message: PushMessage;
    }[],
    now: Date,
  ): Promise<void>;
  /** Pending deliveries due at `now`, locked until the transaction ends (SKIP LOCKED). */
  lockDue(now: Date, limit: number): Promise<Delivery[]>;
  markSent(id: string, ticketId: string, now: Date): Promise<void>;
  markFailed(id: string, error: string, now: Date): Promise<void>;
  /** Back to pending, tried again at `nextAttemptAt`. */
  postpone(id: string, error: string, nextAttemptAt: Date): Promise<void>;
  /** Sent deliveries whose receipt is due (sent before `sentBefore`), locked. */
  lockAwaitingReceipt(sentBefore: Date, limit: number): Promise<Delivery[]>;
  markDelivered(id: string, now: Date): Promise<void>;
  /** Deletes deliveries finished (delivered or failed) before `before`; returns how many. */
  purgeFinished(before: Date): Promise<number>;
}

/** The notifier's repositories, bound to one connection or transaction. */
export interface NotifierStore {
  notifications: NotificationRepository;
  tokens: PushTokenRepository;
  preferences: PreferenceRepository;
  deliveries: DeliveryRepository;
}

export interface NotifierStores {
  /** On the service's connection pool, outside any transaction. */
  root: NotifierStore;
  /** Bound to `tx`, e.g. the transaction of a message being handled. */
  bind(tx: Executor): NotifierStore;
  /** Runs `work` in a new transaction. */
  transaction<T>(work: (store: NotifierStore) => Promise<T>): Promise<T>;
}
export const NOTIFIER_STORES = Symbol("NotifierStores");

/** Injection token of the Clock (systemClock in production). */
export const CLOCK = Symbol("Clock");

/** Expo's push service. */
export interface PushGateway {
  /** One outcome per message, in order (the ticket id when accepted). */
  send(messages: (PushMessage & { to: string })[]): Promise<PushOutcome[]>;
  /** Final outcome of each ticket Expo has a receipt for. */
  receipts(ticketIds: string[]): Promise<Map<string, PushOutcome>>;
}
export const PUSH_GATEWAY = Symbol("PushGateway");
