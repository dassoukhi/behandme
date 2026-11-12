import { Inject, Injectable } from "@nestjs/common";
import { type Kysely, type Selectable, sql } from "kysely";
import { DATABASE } from "@lib/platform";
import type { Executor } from "@lib/messaging";
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  type RenderedNotification,
} from "../domain/notification.js";
import { type EmailContent, emailKind } from "../domain/email.js";
import type { PushMessage } from "../domain/push.js";
import type {
  Delivery,
  DeliveryRepository,
  EmailDelivery,
  EmailDeliveryRepository,
  NotificationRepository,
  NotifierStore,
  NotifierStores,
  PeopleRepository,
  Person,
  PreferenceRepository,
  PushTokenRepository,
  StoredNotification,
} from "../application/ports.js";
import type { NotificationsTable, NotifyDatabase } from "./tables.js";

type Db = Kysely<NotifyDatabase>;

function notify(db: Executor): Db {
  return (db as unknown as Db).withSchema("notify");
}

class KyselyNotifications implements NotificationRepository {
  constructor(private readonly db: Db) {}

  async insert(
    notifications: RenderedNotification[],
  ): Promise<StoredNotification[]> {
    if (notifications.length === 0) return [];
    const rows = await this.db
      .insertInto("notifications")
      .values(
        notifications.map((d) => ({
          user_id: d.userId,
          type: d.type,
          title: d.title,
          body: d.body,
          data: JSON.stringify(d.data),
        })),
      )
      .returningAll()
      .execute();
    return rows.map(toStored);
  }

  async list(userId: string, limit: number): Promise<StoredNotification[]> {
    const rows = await this.db
      .selectFrom("notifications")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .orderBy("id")
      .limit(limit)
      .execute();
    return rows.map(toStored);
  }

  async unreadCounts(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom("notifications")
      .select(["user_id", (eb) => eb.fn.countAll<string>().as("count")])
      .where("user_id", "in", userIds)
      .where("read_at", "is", null)
      .groupBy("user_id")
      .execute();
    return new Map(rows.map((r) => [r.user_id, Number(r.count)]));
  }

  async setRead(
    userId: string,
    id: string,
    read: boolean,
    now: Date,
  ): Promise<StoredNotification | null> {
    const row = await this.db
      .updateTable("notifications")
      // Keeps the first read time when marked read again.
      .set({ read_at: read ? sql<Date>`coalesce(read_at, ${now})` : null })
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .returningAll()
      .executeTakeFirst();
    return row ? toStored(row) : null;
  }

  async markAllRead(userId: string, now: Date): Promise<number> {
    const result = await this.db
      .updateTable("notifications")
      .set({ read_at: now })
      .where("user_id", "=", userId)
      .where("read_at", "is", null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom("notifications")
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.db
      .deleteFrom("notifications")
      .where("user_id", "=", userId)
      .execute();
  }

  async purgeRead(before: Date): Promise<number> {
    const result = await this.db
      .deleteFrom("notifications")
      .where("read_at", "<", before)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}

class KyselyPushTokens implements PushTokenRepository {
  constructor(private readonly db: Db) {}

  async register(userId: string, token: string): Promise<void> {
    await this.db
      .insertInto("push_tokens")
      .values({ token, user_id: userId })
      .onConflict((oc) => oc.column("token").doUpdateSet({ user_id: userId }))
      .execute();
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.db
      .deleteFrom("push_tokens")
      .where("token", "=", token)
      .where("user_id", "=", userId)
      .execute();
  }

  async tokensOf(userIds: string[]): Promise<Map<string, string[]>> {
    const tokens = new Map<string, string[]>();
    if (userIds.length === 0) return tokens;
    const rows = await this.db
      .selectFrom("push_tokens")
      .select(["user_id", "token"])
      .where("user_id", "in", userIds)
      .orderBy("token")
      .execute();
    for (const { user_id, token } of rows) {
      tokens.set(user_id, [...(tokens.get(user_id) ?? []), token]);
    }
    return tokens;
  }

  async remove(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.db
      .deleteFrom("push_tokens")
      .where("token", "in", tokens)
      .execute();
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.db
      .deleteFrom("push_tokens")
      .where("user_id", "=", userId)
      .execute();
  }
}

class KyselyPreferences implements PreferenceRepository {
  constructor(private readonly db: Db) {}

  async getMany(userIds: string[]): Promise<Map<string, Preferences>> {
    const preferences = new Map(
      userIds.map((id) => [id, { ...DEFAULT_PREFERENCES }]),
    );
    if (userIds.length === 0) return preferences;
    const rows = await this.db
      .selectFrom("preferences")
      .select([
        "user_id",
        "push_enabled",
        "email_enabled",
        "language",
        "time_zone",
      ])
      .where("user_id", "in", userIds)
      .execute();
    for (const { user_id, ...prefs } of rows) preferences.set(user_id, prefs);
    return preferences;
  }

  async update(
    userId: string,
    changes: Partial<Preferences>,
  ): Promise<Preferences> {
    const values = { ...DEFAULT_PREFERENCES, ...changes };
    const row = await this.db
      .insertInto("preferences")
      .values({ user_id: userId, ...values })
      .onConflict((oc) =>
        oc
          .column("user_id")
          .doUpdateSet({ ...changes, updated_at: sql<Date>`now()` }),
      )
      .returning(["push_enabled", "email_enabled", "language", "time_zone"])
      .executeTakeFirstOrThrow();
    return row;
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.db
      .deleteFrom("preferences")
      .where("user_id", "=", userId)
      .execute();
  }
}

class KyselyDeliveries implements DeliveryRepository {
  constructor(private readonly db: Db) {}

  private readonly columns = [
    "id",
    "token",
    "message",
    "attempts",
    "ticket_id",
    "sent_at",
  ] as const;

  async enqueue(
    deliveries: {
      notificationId: string;
      token: string;
      message: PushMessage;
    }[],
    now: Date,
  ): Promise<void> {
    if (deliveries.length === 0) return;
    await this.db
      .insertInto("deliveries")
      .values(
        deliveries.map((d) => ({
          notification_id: d.notificationId,
          token: d.token,
          message: JSON.stringify(d.message),
          next_attempt_at: now,
        })),
      )
      .execute();
  }

  async lockDue(now: Date, limit: number): Promise<Delivery[]> {
    return this.db
      .selectFrom("deliveries")
      .select(this.columns)
      .where("status", "=", "pending")
      .where("next_attempt_at", "<=", now)
      .orderBy("next_attempt_at")
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();
  }

  async markSent(id: string, ticketId: string, now: Date): Promise<void> {
    await this.db
      .updateTable("deliveries")
      .set((eb) => ({
        status: "sent",
        ticket_id: ticketId,
        sent_at: now,
        attempts: eb("attempts", "+", 1),
        error: null,
      }))
      .where("id", "=", id)
      .execute();
  }

  async markFailed(id: string, error: string, now: Date): Promise<void> {
    await this.db
      .updateTable("deliveries")
      .set((eb) => ({
        status: "failed",
        error,
        checked_at: now,
        attempts: eb(
          "attempts",
          "+",
          sql<number>`case when status = 'pending' then 1 else 0 end`,
        ),
      }))
      .where("id", "=", id)
      .execute();
  }

  async postpone(
    id: string,
    error: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.db
      .updateTable("deliveries")
      .set((eb) => ({
        error,
        next_attempt_at: nextAttemptAt,
        attempts: eb("attempts", "+", 1),
      }))
      .where("id", "=", id)
      .execute();
  }

  async lockAwaitingReceipt(
    sentBefore: Date,
    limit: number,
  ): Promise<Delivery[]> {
    return this.db
      .selectFrom("deliveries")
      .select(this.columns)
      .where("status", "=", "sent")
      .where("sent_at", "<", sentBefore)
      .orderBy("sent_at")
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();
  }

  async markDelivered(id: string, now: Date): Promise<void> {
    await this.db
      .updateTable("deliveries")
      .set({ status: "delivered", checked_at: now })
      .where("id", "=", id)
      .execute();
  }

  async purgeFinished(before: Date): Promise<number> {
    const result = await this.db
      .deleteFrom("deliveries")
      .where("status", "in", ["delivered", "failed"])
      .where("checked_at", "<", before)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}

class KyselyPeople implements PeopleRepository {
  constructor(private readonly db: Db) {}

  async save(userId: string, person: Person, occurredAt: Date): Promise<void> {
    const values = {
      email: person.email,
      first_name: person.firstName,
      last_name: person.lastName,
      occurred_at: occurredAt,
    };
    await this.db
      .insertInto("people")
      .values({ user_id: userId, ...values })
      .onConflict((oc) =>
        oc
          .column("user_id")
          .doUpdateSet({ ...values, updated_at: sql<Date>`now()` })
          // The row being replaced, by its table's name: kept when newer, or when the account is gone.
          .where(
            sql<boolean>`not people.deleted and people.occurred_at < excluded.occurred_at`,
          ),
      )
      .execute();
  }

  async getMany(userIds: string[]): Promise<Map<string, Person>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom("people")
      .select(["user_id", "email", "first_name", "last_name"])
      .where("user_id", "in", userIds)
      .where("deleted", "=", false)
      .execute();
    return new Map(
      rows.map((r) => [
        r.user_id,
        { email: r.email, firstName: r.first_name, lastName: r.last_name },
      ]),
    );
  }

  async forget(userId: string, at: Date): Promise<void> {
    const gone = {
      email: null,
      first_name: null,
      last_name: null,
      deleted: true,
    };
    await this.db
      .insertInto("people")
      .values({ user_id: userId, ...gone, occurred_at: at })
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet({
          ...gone,
          occurred_at: sql<Date>`greatest(people.occurred_at, excluded.occurred_at)`,
          updated_at: sql<Date>`now()`,
        }),
      )
      .execute();
  }

  async purgeForgotten(before: Date): Promise<number> {
    const result = await this.db
      .deleteFrom("people")
      .where("deleted", "=", true)
      .where("occurred_at", "<", before)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}

class KyselyEmailDeliveries implements EmailDeliveryRepository {
  constructor(private readonly db: Db) {}

  async enqueue(
    emails: { notificationId: string; to: string; content: EmailContent }[],
    now: Date,
  ): Promise<void> {
    if (emails.length === 0) return;
    await this.db
      .insertInto("email_deliveries")
      .values(
        emails.map((e) => ({
          notification_id: e.notificationId,
          to_address: e.to,
          content: JSON.stringify(e.content),
          next_attempt_at: now,
          created_at: now,
        })),
      )
      .execute();
  }

  async claimDue(
    now: Date,
    leaseUntil: Date,
    limit: number,
  ): Promise<EmailDelivery[]> {
    // One statement: the rows it takes are locked until it commits, and skipped by other senders.
    const rows = await this.db
      .updateTable("email_deliveries")
      .set((eb) => ({
        status: "sending",
        attempts: eb("attempts", "+", 1),
        next_attempt_at: leaseUntil,
      }))
      .where("notification_id", "in", (eb) =>
        eb
          .selectFrom("email_deliveries")
          .select("notification_id")
          .where("status", "in", ["pending", "sending"])
          .where("next_attempt_at", "<=", now)
          .orderBy("next_attempt_at")
          .limit(limit)
          .forUpdate()
          .skipLocked(),
      )
      .returning([
        "notification_id",
        "to_address",
        "content",
        "attempts",
        "created_at",
      ])
      .execute();
    return rows
      .map((r) => ({
        notificationId: r.notification_id,
        to: r.to_address,
        content: r.content,
        attempts: r.attempts,
        createdAt: r.created_at,
      }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async markSent(
    notificationId: string,
    providerId: string | null,
    now: Date,
  ): Promise<void> {
    await this.db
      .updateTable("email_deliveries")
      .set({
        status: "sent",
        provider_id: providerId,
        error: null,
        finished_at: now,
      })
      .where("notification_id", "=", notificationId)
      .execute();
  }

  async markFailed(
    notificationId: string,
    error: string,
    now: Date,
  ): Promise<void> {
    await this.db
      .updateTable("email_deliveries")
      .set({ status: "failed", error, finished_at: now })
      .where("notification_id", "=", notificationId)
      .execute();
  }

  async postpone(
    notificationId: string,
    error: string,
    nextAttemptAt: Date,
    countAttempt: boolean,
  ): Promise<void> {
    await this.db
      .updateTable("email_deliveries")
      .set((eb) => ({
        status: "pending",
        error,
        next_attempt_at: nextAttemptAt,
        attempts: eb("attempts", "-", countAttempt ? 0 : 1),
      }))
      .where("notification_id", "=", notificationId)
      .execute();
  }

  async purgeFinished(before: Date): Promise<number> {
    const result = await this.db
      .deleteFrom("email_deliveries")
      .where("status", "in", ["sent", "failed"])
      .where("finished_at", "<", before)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async recentRegular(
    userIds: string[],
    since: Date,
  ): Promise<Map<string, { count: number; kinds: Set<string> }>> {
    const recent = new Map<string, { count: number; kinds: Set<string> }>();
    if (userIds.length === 0) return recent;
    const rows = await this.db
      .selectFrom("email_deliveries as e")
      .innerJoin("notifications as n", "n.id", "e.notification_id")
      .select(["n.user_id", "n.type", sql<string>`n.data->>'url'`.as("url")])
      .where("n.user_id", "in", userIds)
      .where("e.created_at", ">", since)
      .where(sql<boolean>`(e.content->>'critical')::boolean`, "=", false)
      .execute();
    for (const row of rows) {
      const entry = recent.get(row.user_id) ?? { count: 0, kinds: new Set() };
      entry.count++;
      entry.kinds.add(emailKind(row.type, row.url ?? ""));
      recent.set(row.user_id, entry);
    }
    return recent;
  }
}

function store(db: Executor): NotifierStore {
  const scoped = notify(db);
  return {
    notifications: new KyselyNotifications(scoped),
    tokens: new KyselyPushTokens(scoped),
    preferences: new KyselyPreferences(scoped),
    deliveries: new KyselyDeliveries(scoped),
    people: new KyselyPeople(scoped),
    emails: new KyselyEmailDeliveries(scoped),
  };
}

/** The notifier's repositories on its connection (svc_notifier) or one of its transactions. */
@Injectable()
export class KyselyNotifierStores implements NotifierStores {
  readonly root: NotifierStore;

  constructor(@Inject(DATABASE) private readonly db: Kysely<any>) {
    this.root = store(db);
  }

  bind(tx: Executor): NotifierStore {
    return store(tx);
  }

  transaction<T>(work: (store: NotifierStore) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((tx) => work(store(tx)));
  }
}

function toStored(row: Selectable<NotificationsTable>): StoredNotification {
  return {
    ...row,
    read_at: row.read_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}
