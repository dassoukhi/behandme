import type { Executor } from "@lib/messaging";
import type { EmailContent } from "../domain/email.js";
import type {
  Preferences,
  RenderedNotification,
} from "../domain/notification.js";
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
  /** Stores the notifications; returns them with their ids, in the same order. */
  insert(notifications: RenderedNotification[]): Promise<StoredNotification[]>;
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

/** The notifier's copy of a user's address and name (event user.profile_changed). */
export interface Person {
  /** Null while the address is not verified: no e-mail then. */
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface PeopleRepository {
  /**
   * Creates or replaces the copy of a user's address and name, as the gateway saw it at `occurredAt`:
   * ignored when a newer one is kept, or when the account is gone.
   */
  save(userId: string, person: Person, occurredAt: Date): Promise<void>;
  /** The people known among `userIds` (accounts still there). */
  getMany(userIds: string[]): Promise<Map<string, Person>>;
  /** The account is gone at `at`: forget the address and name, and refuse older events. */
  forget(userId: string, at: Date): Promise<void>;
  /** Deletes what is left of accounts gone before `before`; returns how many. */
  purgeForgotten(before: Date): Promise<number>;
}

export interface EmailDelivery {
  notificationId: string;
  to: string;
  content: EmailContent;
  /** Including the attempt in progress. */
  attempts: number;
  createdAt: Date;
}

export interface EmailDeliveryRepository {
  /** New pending e-mails, due at `now`. */
  enqueue(
    emails: { notificationId: string; to: string; content: EmailContent }[],
    now: Date,
  ): Promise<void>;
  /**
   * Takes e-mails due at `now` (pending, or taken by a sender that never came back) until `leaseUntil`,
   * counting an attempt. Other senders skip them meanwhile.
   */
  claimDue(
    now: Date,
    leaseUntil: Date,
    limit: number,
  ): Promise<EmailDelivery[]>;
  markSent(
    notificationId: string,
    providerId: string | null,
    now: Date,
  ): Promise<void>;
  markFailed(notificationId: string, error: string, now: Date): Promise<void>;
  /**
   * Back to pending, tried again at `nextAttemptAt`. `countAttempt` false gives back the attempt the
   * claim counted (a quota or rate limit, not the e-mail's fault).
   */
  postpone(
    notificationId: string,
    error: string,
    nextAttemptAt: Date,
    countAttempt: boolean,
  ): Promise<void>;
  /** Deletes e-mails finished (sent or failed) before `before`; returns how many. */
  purgeFinished(before: Date): Promise<number>;
  /**
   * The non-critical e-mails queued for each of `userIds` since `since`: how many, and the kinds
   * ("type url", e.g. "trust_added /people/user_a").
   */
  recentRegular(
    userIds: string[],
    since: Date,
  ): Promise<Map<string, { count: number; kinds: Set<string> }>>;
}

/** The notifier's repositories, bound to one connection or transaction. */
export interface NotifierStore {
  notifications: NotificationRepository;
  tokens: PushTokenRepository;
  preferences: PreferenceRepository;
  deliveries: DeliveryRepository;
  people: PeopleRepository;
  emails: EmailDeliveryRepository;
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

/** An e-mail for the provider: rendered by the adapter (domain content in, HTML out). */
export interface OutgoingEmail {
  to: string;
  content: EmailContent;
  /** The same key for every try of one e-mail: the provider sends it once. */
  idempotencyKey: string;
}

export type EmailSendResult =
  | { status: "sent"; id: string | null }
  /** Try again later (provider down, unknown error). */
  | { status: "retry"; error: string }
  /** Too many requests a second: try again in a moment, not the e-mail's fault. */
  | { status: "rate_limited"; error: string }
  /** The day's (or month's) quota is used up: try again tomorrow. */
  | { status: "quota"; error: string }
  /** The key, sender or domain is wrong at the provider: wait for someone to fix it, try again in an hour. */
  | { status: "misconfigured"; error: string }
  /** The provider refuses this e-mail for good (invalid address…). */
  | { status: "rejected"; error: string };

/** The e-mail provider (Resend), or a stand-in that is off when no key is configured. */
export interface EmailGateway {
  /** False when no provider is configured: no e-mail is queued then. */
  readonly enabled: boolean;
  send(email: OutgoingEmail): Promise<EmailSendResult>;
}
export const EMAIL_GATEWAY = Symbol("EmailGateway");
