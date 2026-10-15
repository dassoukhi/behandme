import { type Kysely, sql } from "kysely";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { KeysRotated, TrustAdded, UserDeleted } from "@lib/contracts";
import { NotFoundError } from "@lib/kernel";
import { createEnvelope, PgmqBus, QueueConsumer } from "@lib/messaging";
import { FakeClock, startTestDatabase, type TestDatabase } from "@lib/testing";
import { DeliveryService } from "./application/delivery.service.js";
import { InboxService } from "./application/inbox.service.js";
import { NotificationEvents } from "./application/notification-events.js";
import { NotifyService } from "./application/notify.service.js";
import { MAX_SEND_ATTEMPTS } from "./domain/push.js";
import { KyselyNotifierStores } from "./infrastructure/kysely-notifier.stores.js";
import { FakePush } from "./testing/fake-push.js";
import { on } from "@lib/contracts";

// The notifier's use cases on the real schema (PGlite), as svc_notifier.
const ALICE = "user_alice";
const BOB = "user_bob";
const TOKEN_B1 = "ExponentPushToken[bob-phone]";
const TOKEN_B2 = "ExponentPushToken[bob-tablet]";

let t: TestDatabase;
let db: Kysely<any>;
let clock: FakeClock;
let push: FakePush;
let stores: KyselyNotifierStores;
let inbox: InboxService;
let events: NotificationEvents;
let delivery: DeliveryService;
const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeAll(async () => {
  t = await startTestDatabase();
  db = t.db;
}, 60_000);
afterAll(() => t?.close());

beforeEach(async () => {
  await sql`
    reset role;
    delete from notify.deliveries; delete from notify.notifications;
    delete from notify.push_tokens; delete from notify.preferences;
    delete from notify.processed_messages; delete from pgmq.q_notifier; delete from pgmq.a_notifier;
    set role svc_notifier;
  `.execute(db);
  clock = new FakeClock(new Date("2026-10-14T10:00:00Z"));
  push = new FakePush();
  stores = new KyselyNotifierStores(db);
  inbox = new InboxService(stores, clock);
  events = new NotificationEvents(new NotifyService(clock), clock);
  delivery = new DeliveryService(stores, push, clock);
});
afterEach(() => sql`reset role`.execute(db));

/** Delivers events to the notifier's queue and runs its consumer, as in production. */
async function receive(...envelopes: ReturnType<typeof createEnvelope>[]) {
  const bus = new PgmqBus();
  for (const envelope of envelopes) await bus.send(db, "notifier", envelope);
  const consumer = new QueueConsumer(db, {
    queue: "notifier",
    schema: "notify",
    bus,
    logger,
    handlers: Object.fromEntries([
      on(TrustAdded, (payload, _e, tx) =>
        events.trustAdded(stores.bind(tx), payload),
      ),
      on(KeysRotated, (payload, _e, tx) =>
        events.keysRotated(stores.bind(tx), payload),
      ),
      on(UserDeleted, ({ userId }, _e, tx) =>
        events.userDeleted(stores.bind(tx), userId),
      ),
    ]),
  });
  return consumer.pollOnce();
}

const aliceAddsBob = () =>
  createEnvelope(
    TrustAdded.create({
      ownerId: ALICE,
      trustedId: BOB,
      ownerName: "Alice Martin",
    }),
    { correlationId: "c" },
    clock,
  );

const deliveries = async () =>
  (
    await sql<{
      token: string;
      status: string;
      message: any;
      attempts: number;
      error: string | null;
    }>`
      select token, status, message, attempts, error from notify.deliveries order by token`.execute(
      db,
    )
  ).rows;

describe("trust.added", () => {
  it("puts a notification in the inbox and a push per device of the person added", async () => {
    await inbox.registerDevice(BOB, TOKEN_B1);
    await inbox.registerDevice(BOB, TOKEN_B2);

    expect(await receive(aliceAddsBob())).toMatchObject({ handled: 1 });

    const [notification] = await inbox.list(BOB);
    expect(notification).toMatchObject({
      type: "trust_added",
      title: "Nouveau proche",
      body: "Alice Martin vous a ajouté à ses proches.",
      data: { url: `/people/${ALICE}` },
      read_at: null,
    });
    expect(notification).not.toHaveProperty("user_id");
    const queued = await deliveries();
    expect(queued.map((d) => [d.token, d.status])).toEqual([
      [TOKEN_B1, "pending"],
      [TOKEN_B2, "pending"],
    ]);
    expect(queued[0].message).toMatchObject({
      badge: 1,
      data: { notificationId: notification.id, url: `/people/${ALICE}` },
    });
    expect(await inbox.list(ALICE)).toEqual([]);
  });

  it("creates the notification once when the event arrives twice", async () => {
    const event = aliceAddsBob();
    await receive(event, event);
    expect(await inbox.list(BOB)).toHaveLength(1);
  });

  it("keeps it in the inbox only when the person turned push off", async () => {
    await inbox.registerDevice(BOB, TOKEN_B1);
    await inbox.updatePreferences(BOB, { push_enabled: false });
    await receive(aliceAddsBob());
    expect(await inbox.list(BOB)).toHaveLength(1);
    expect(await deliveries()).toEqual([]);
  });
});

describe("keys.rotated", () => {
  const bobResetsKeys = () =>
    createEnvelope(
      KeysRotated.create({
        userId: BOB,
        keyVersion: 2,
        usableFrom: "2026-10-17T10:00:00.000Z",
        userName: "Bob Durand",
        trusterIds: [ALICE],
      }),
      { correlationId: "c" },
      clock,
    );

  it("alerts the user even with push off, and tells the people who trust them", async () => {
    await inbox.registerDevice(BOB, TOKEN_B1);
    await inbox.updatePreferences(BOB, { push_enabled: false });
    await inbox.registerDevice(ALICE, "ExponentPushToken[alice]");

    expect(await receive(bobResetsKeys())).toMatchObject({ handled: 1 });

    expect(await inbox.list(BOB)).toMatchObject([
      {
        type: "keys_reset",
        title: "Vos clés ont été réinitialisées",
        data: { url: "/settings/security" },
      },
    ]);
    expect(await inbox.list(ALICE)).toMatchObject([
      {
        type: "contact_keys_reset",
        body: "Bob Durand a réinitialisé ses clés. Comparez son nouveau code de sécurité avant de lui confier un accès.",
        data: { url: `/people/${BOB}` },
      },
    ]);
    // Bob's alert is critical: it reaches his phone although he turned push off.
    expect((await deliveries()).map((d) => d.token).sort()).toEqual(
      ["ExponentPushToken[alice]", TOKEN_B1].sort(),
    );
  });
});

describe("user.deleted", () => {
  it("forgets the user's notifications, devices and settings only", async () => {
    await inbox.registerDevice(BOB, TOKEN_B1);
    await inbox.registerDevice(ALICE, "ExponentPushToken[alice]");
    await inbox.updatePreferences(BOB, { push_enabled: false });
    await receive(aliceAddsBob());

    await receive(
      createEnvelope(
        UserDeleted.create({ userId: BOB }),
        { correlationId: "c" },
        clock,
      ),
    );

    expect(await inbox.list(BOB)).toEqual([]);
    expect(await inbox.preferences(BOB)).toEqual({ push_enabled: true });
    const { rows } = await sql<{
      user_id: string;
    }>`select user_id from notify.push_tokens`.execute(db);
    expect(rows).toEqual([{ user_id: ALICE }]);
  });
});

describe("inbox: only the user's own", () => {
  let bobs: string;
  beforeEach(async () => {
    await receive(aliceAddsBob());
    bobs = (await inbox.list(BOB))[0].id;
  });

  it("counts unread notifications per user", async () => {
    expect(await inbox.unreadCount(BOB)).toEqual({ count: 1 });
    expect(await inbox.unreadCount(ALICE)).toEqual({ count: 0 });
  });

  it("marks a notification read, then unread", async () => {
    clock.advance(60_000);
    const read = await inbox.setRead(BOB, bobs, true);
    expect(read.read_at).toBe("2026-10-14T10:01:00.000Z");
    clock.advance(60_000);
    expect((await inbox.setRead(BOB, bobs, true)).read_at).toBe(
      "2026-10-14T10:01:00.000Z",
    );
    expect((await inbox.setRead(BOB, bobs, false)).read_at).toBeNull();
  });

  it.each([
    ["mark as read", () => inbox.setRead(ALICE, bobs, true)],
    ["delete", () => inbox.remove(ALICE, bobs)],
  ])("cannot %s someone else's (404)", async (_action, act) => {
    await expect(act()).rejects.toThrow(
      new NotFoundError("Notification not found"),
    );
    expect(await inbox.unreadCount(BOB)).toEqual({ count: 1 });
  });

  it("marks all of the user's notifications read, nobody else's", async () => {
    await receive(
      createEnvelope(
        TrustAdded.create({ ownerId: BOB, trustedId: ALICE, ownerName: null }),
        { correlationId: "c" },
        clock,
      ),
    );
    expect(await inbox.markAllRead(BOB)).toEqual({ updated: 1 });
    expect(await inbox.markAllRead(BOB)).toEqual({ updated: 0 });
    expect(await inbox.unreadCount(ALICE)).toEqual({ count: 1 });
  });

  it("deletes the user's notification", async () => {
    await inbox.remove(BOB, bobs);
    expect(await inbox.list(BOB)).toEqual([]);
  });
});

describe("devices", () => {
  it("belong to whoever signed in on them last", async () => {
    await inbox.registerDevice(ALICE, TOKEN_B1);
    await inbox.registerDevice(BOB, TOKEN_B1);
    await receive(aliceAddsBob());
    expect((await deliveries()).map((d) => d.token)).toEqual([TOKEN_B1]);
  });

  it("are only unregistered by their user", async () => {
    await inbox.registerDevice(BOB, TOKEN_B1);
    await inbox.unregisterDevice(ALICE, TOKEN_B1);
    await receive(aliceAddsBob());
    expect(await deliveries()).toHaveLength(1);

    await inbox.unregisterDevice(BOB, TOKEN_B1);
    await receive(
      createEnvelope(
        TrustAdded.create({
          ownerId: "user_carol",
          trustedId: BOB,
          ownerName: null,
        }),
        { correlationId: "c" },
        clock,
      ),
    );
    expect(await deliveries()).toHaveLength(1);
  });
});

describe("sending pushes", () => {
  beforeEach(async () => {
    await inbox.registerDevice(BOB, TOKEN_B1);
    await inbox.registerDevice(BOB, TOKEN_B2);
    await receive(aliceAddsBob());
  });

  it("sends each due push once and keeps Expo's ticket", async () => {
    expect(await delivery.sendDue(logger)).toBe(2);
    expect(await delivery.sendDue(logger)).toBe(0);
    expect(push.sent.map((m) => m.to)).toEqual([TOKEN_B1, TOKEN_B2]);
    expect(push.sent[0]).toMatchObject({
      title: "Nouveau proche",
      sound: "default",
      channelId: "default",
    });
    expect((await deliveries()).map((d) => d.status)).toEqual(["sent", "sent"]);
  });

  it("forgets a device Expo reports as unregistered", async () => {
    push.outcomes.set(TOKEN_B1, {
      status: "error",
      message: "gone",
      error: "DeviceNotRegistered",
    });
    await delivery.sendDue(logger);
    const [b1, b2] = await deliveries();
    expect(b1).toMatchObject({
      status: "failed",
      error: "DeviceNotRegistered",
    });
    expect(b2.status).toBe("sent");
    const { rows } = await sql<{
      token: string;
    }>`select token from notify.push_tokens`.execute(db);
    expect(rows).toEqual([{ token: TOKEN_B2 }]);
  });

  it("retries later when Expo is down, then gives up", async () => {
    push.failWith = new Error("Expo unreachable");
    await delivery.sendDue(logger);
    expect((await deliveries())[0]).toMatchObject({
      status: "pending",
      attempts: 1,
    });
    // Not due again before the backoff.
    expect(await delivery.sendDue(logger)).toBe(0);

    for (let i = 1; i < MAX_SEND_ATTEMPTS; i++) {
      clock.advance(3_600_000);
      await delivery.sendDue(logger);
    }
    expect((await deliveries()).map((d) => [d.status, d.attempts])).toEqual([
      ["failed", MAX_SEND_ATTEMPTS],
      ["failed", MAX_SEND_ATTEMPTS],
    ]);
    expect(push.sent).toEqual([]);
  });

  it("records receipts once they are due, and waits for missing ones up to a day", async () => {
    await delivery.sendDue(logger);
    push.receiptsByTicket.set("ticket-1", { status: "ok" });
    push.receiptsByTicket.set("ticket-2", {
      status: "error",
      message: "gone",
      error: "DeviceNotRegistered",
    });

    // Too early: receipts are asked 15 minutes after sending.
    expect(await stores.transaction((s) => delivery.checkReceipts(s))).toEqual({
      delivered: 0,
      failed: 0,
    });
    clock.advance(16 * 60_000);
    expect(await stores.transaction((s) => delivery.checkReceipts(s))).toEqual({
      delivered: 1,
      failed: 1,
    });
    expect((await deliveries()).map((d) => d.status)).toEqual([
      "delivered",
      "failed",
    ]);
    const { rows } = await sql<{
      token: string;
    }>`select token from notify.push_tokens`.execute(db);
    expect(rows).toEqual([{ token: TOKEN_B1 }]);
  });

  it("counts a push as delivered when Expo never published its receipt", async () => {
    await delivery.sendDue(logger);
    clock.advance(16 * 60_000);
    await stores.transaction((s) => delivery.checkReceipts(s));
    expect((await deliveries()).map((d) => d.status)).toEqual(["sent", "sent"]);

    clock.advance(24 * 3_600_000);
    await stores.transaction((s) => delivery.checkReceipts(s));
    expect((await deliveries()).map((d) => d.status)).toEqual([
      "delivered",
      "delivered",
    ]);
  });
});

describe("retention", () => {
  it("deletes read notifications after 90 days and finished deliveries after 30", async () => {
    await inbox.registerDevice(BOB, TOKEN_B1);
    await receive(aliceAddsBob());
    await delivery.sendDue(logger);
    await inbox.markAllRead(BOB);

    clock.advance(16 * 60_000);
    push.receiptsByTicket.set("ticket-1", { status: "ok" });
    await stores.transaction((s) => delivery.checkReceipts(s));

    clock.advance(29 * 86_400_000);
    expect(await events.retention(stores.root)).toEqual({
      notifications: 0,
      deliveries: 0,
    });
    clock.advance(2 * 86_400_000);
    expect(await events.retention(stores.root)).toEqual({
      notifications: 0,
      deliveries: 1,
    });

    clock.advance(60 * 86_400_000);
    expect(await events.retention(stores.root)).toEqual({
      notifications: 1,
      deliveries: 0,
    });
  });
});
