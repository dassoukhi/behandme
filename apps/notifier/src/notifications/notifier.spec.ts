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
import {
  ClaimClosed,
  ClaimFiled,
  ClaimReminder,
  ContractReleased,
  ContractRevoked,
  ContractSealed,
  KeyCareReminder,
  KeysBackupOpened,
  KeysRotated,
  KeysTransferred,
  ParticipantLeft,
  TrustAdded,
  UserDeleted,
  UserProfileChanged,
} from "@lib/contracts";
import { NotFoundError } from "@lib/kernel";
import { createEnvelope, PgmqBus, QueueConsumer } from "@lib/messaging";
import { FakeClock, startTestDatabase, type TestDatabase } from "@lib/testing";
import { DeliveryService } from "./application/delivery.service.js";
import { EmailDeliveryService } from "./application/email-delivery.service.js";
import { InboxService } from "./application/inbox.service.js";
import { NotificationEvents } from "./application/notification-events.js";
import { NotifyService } from "./application/notify.service.js";
import { MAX_SEND_ATTEMPTS } from "./domain/push.js";
import { KyselyNotifierStores } from "./infrastructure/kysely-notifier.stores.js";
import { FakeEmail } from "./testing/fake-email.js";
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
let email: FakeEmail;
let stores: KyselyNotifierStores;
let inbox: InboxService;
let events: NotificationEvents;
let delivery: DeliveryService;
let emailDelivery: EmailDeliveryService;
const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeAll(async () => {
  t = await startTestDatabase();
  db = t.db;
}, 60_000);
afterAll(() => t?.close());

beforeEach(async () => {
  await sql`
    reset role;
    delete from notify.email_deliveries; delete from notify.people;
    delete from notify.deliveries; delete from notify.notifications;
    delete from notify.push_tokens; delete from notify.preferences;
    delete from notify.processed_messages; delete from pgmq.q_notifier; delete from pgmq.a_notifier;
    set role svc_notifier;
  `.execute(db);
  clock = new FakeClock(new Date("2026-10-14T10:00:00Z"));
  push = new FakePush();
  email = new FakeEmail();
  stores = new KyselyNotifierStores(db);
  inbox = new InboxService(stores, clock);
  events = new NotificationEvents(new NotifyService(clock, email), clock);
  delivery = new DeliveryService(stores, push, clock);
  emailDelivery = new EmailDeliveryService(stores, email, clock);
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
      on(TrustAdded, (payload, e, tx) =>
        events.trustAdded(stores.bind(tx), payload, e.occurredAt),
      ),
      on(KeysRotated, (payload, e, tx) =>
        events.keysRotated(stores.bind(tx), payload, e.occurredAt),
      ),
      on(KeyCareReminder, (payload, e, tx) =>
        events.keyCareReminder(stores.bind(tx), payload, e.occurredAt),
      ),
      on(ContractSealed, (payload, e, tx) =>
        events.contractSealed(stores.bind(tx), payload, e.occurredAt),
      ),
      on(KeysTransferred, (payload, e, tx) =>
        events.keysTransferred(stores.bind(tx), payload, e.occurredAt),
      ),
      on(KeysBackupOpened, (payload, e, tx) =>
        events.keysBackupOpened(stores.bind(tx), payload, e.occurredAt),
      ),
      on(ClaimFiled, (payload, e, tx) =>
        events.claimFiled(stores.bind(tx), payload, e.occurredAt),
      ),
      on(ClaimReminder, (payload, e, tx) =>
        events.claimReminder(stores.bind(tx), payload, e.occurredAt),
      ),
      on(ClaimClosed, (payload, e, tx) =>
        events.claimClosed(stores.bind(tx), payload, e.occurredAt),
      ),
      on(ContractReleased, (payload, e, tx) =>
        events.contractReleased(stores.bind(tx), payload, e.occurredAt),
      ),
      on(ContractRevoked, (payload, e, tx) =>
        events.contractRevoked(stores.bind(tx), payload, e.occurredAt),
      ),
      on(ParticipantLeft, (payload, e, tx) =>
        events.participantLeft(stores.bind(tx), payload, e.occurredAt),
      ),
      on(UserDeleted, ({ userId }, e, tx) =>
        events.userDeleted(stores.bind(tx), userId, e.occurredAt),
      ),
      on(UserProfileChanged, (payload, e, tx) =>
        events.userProfileChanged(stores.bind(tx), payload, e.occurredAt),
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

/** The gateway tells the notifier someone's address and name. */
const profile = (
  userId: string,
  firstName: string | null,
  email: string | null,
  lastName: string | null = "Martin",
) =>
  createEnvelope(
    UserProfileChanged.create({ userId, email, firstName, lastName }),
    { correlationId: "c" },
    clock,
  );

/** The queued e-mails, oldest first. */
async function emailRows() {
  const { rows } = await sql<{
    notification_id: string;
    to_address: string;
    content: Record<string, any>;
    status: string;
    attempts: number;
    next_attempt_at: Date;
    provider_id: string | null;
    error: string | null;
  }>`select notification_id, to_address, content, status, attempts, next_attempt_at, provider_id, error
     from notify.email_deliveries order by created_at, notification_id`.execute(
    db,
  );
  return rows;
}

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

  it("writes in the language of the person added, in the inbox and the push", async () => {
    await inbox.updatePreferences(BOB, { language: "en" });
    await inbox.registerDevice(BOB, TOKEN_B1);

    await receive(aliceAddsBob());

    const copy = {
      title: "New trusted contact",
      body: "Alice Martin added you as a trusted contact.",
    };
    expect((await inbox.list(BOB))[0]).toMatchObject(copy);
    expect((await deliveries())[0].message).toMatchObject({
      ...copy,
      badge: 1,
    });
  });

  it("changes the language without touching the push setting, and the reverse", async () => {
    await inbox.updatePreferences(BOB, { push_enabled: false });
    expect(await inbox.updatePreferences(BOB, { language: "en" })).toEqual({
      push_enabled: false,
      email_enabled: true,
      language: "en",
      time_zone: "Europe/Paris",
    });
    expect(await inbox.updatePreferences(BOB, { push_enabled: true })).toEqual({
      push_enabled: true,
      email_enabled: true,
      language: "en",
      time_zone: "Europe/Paris",
    });
  });

  it("changes the e-mail setting and the time zone alone", async () => {
    await inbox.updatePreferences(BOB, { language: "en" });
    expect(
      await inbox.updatePreferences(BOB, {
        email_enabled: false,
        time_zone: "America/Montreal",
      }),
    ).toEqual({
      push_enabled: true,
      email_enabled: false,
      language: "en",
      time_zone: "America/Montreal",
    });
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

describe("keys.care_reminder", () => {
  const reminder = (kind: "phrase_check" | "key_checkup") =>
    createEnvelope(
      KeyCareReminder.create({ userId: BOB, kind }),
      { correlationId: "c" },
      clock,
    );

  it.each([
    [
      "phrase_check",
      "Votre phrase est-elle toujours à sa place ?",
      "/keys/check",
    ],
    ["key_checkup", "Votre point annuel", "/"],
  ] as const)("tells the user to act on %s", async (kind, title, url) => {
    await inbox.registerDevice(BOB, TOKEN_B1);
    expect(await receive(reminder(kind))).toMatchObject({ handled: 1 });
    expect(await inbox.list(BOB)).toMatchObject([
      { type: kind, title, data: { url } },
    ]);
    expect(await deliveries()).toHaveLength(1);
  });

  it("writes in the user's language, and stays quiet when they turned push off", async () => {
    await inbox.updatePreferences(BOB, {
      language: "en",
      push_enabled: false,
    });
    await inbox.registerDevice(BOB, TOKEN_B1);
    await receive(reminder("key_checkup"));
    expect(await inbox.list(BOB)).toMatchObject([
      { title: "Your yearly check-up" },
    ]);
    expect(await deliveries()).toEqual([]);
  });
});

describe("keys.transferred", () => {
  it("alerts the user even with push off: it may not have been them", async () => {
    await inbox.registerDevice(BOB, TOKEN_B1);
    await inbox.updatePreferences(BOB, { push_enabled: false });
    await receive(
      createEnvelope(
        KeysTransferred.create({ userId: BOB }),
        { correlationId: "c" },
        clock,
      ),
    );
    expect(await inbox.list(BOB)).toMatchObject([
      {
        type: "keys_transferred",
        title: "Vos clés sont sur un nouveau téléphone",
        data: { url: "/settings/security" },
      },
    ]);
    expect(await deliveries()).toHaveLength(1);
  });
});

describe("keys.backup_opened", () => {
  it("alerts the user in their language, even with push off: it may not have been them", async () => {
    await inbox.registerDevice(BOB, TOKEN_B1);
    await inbox.updatePreferences(BOB, { push_enabled: false, language: "en" });
    await receive(
      createEnvelope(
        KeysBackupOpened.create({ userId: BOB }),
        { correlationId: "c" },
        clock,
      ),
    );
    expect(await inbox.list(BOB)).toMatchObject([
      {
        type: "keys_backup_opened",
        title: "Your keys were recovered with your passkey",
        data: { url: "/settings/security" },
      },
    ]);
    expect(await deliveries()).toHaveLength(1);
  });
});

describe("contract.sealed", () => {
  const CONTRACT = "5d2f7a10-8c3e-4b6a-9f21-0a1b2c3d4e5f";

  it("tells each new validator that someone counts on them, naming the category only", async () => {
    await inbox.updatePreferences(ALICE, { language: "en" });
    await receive(
      createEnvelope(
        ContractSealed.create({
          contractId: CONTRACT,
          category: "devices",
          ownerId: "user_owner",
          newValidatorIds: [BOB, ALICE],
        }),
        { correlationId: "c" },
        clock,
      ),
    );
    expect(await inbox.list(BOB)).toMatchObject([
      {
        type: "validator_chosen",
        title: "Un proche compte sur vous",
        body: "Vous êtes validateur du contrat « Appareils ». Gardez vos clés à l'abri : une minute suffit.",
        data: { url: "/keys" },
      },
    ]);
    expect(await inbox.list(ALICE)).toMatchObject([
      { title: "Someone close is counting on you" },
    ]);
  });
});

describe("claims", () => {
  const CONTRACT = "5d2f7a10-8c3e-4b6a-9f21-0a1b2c3d4e5f";
  const CLAIM = "9b0c2d4e-6f71-4a83-b5c6-d7e8f9a0b1c2";
  const CAROL = "user_carol";
  const envelope = <P>(event: { type: string; version: number; payload: P }) =>
    createEnvelope(event, { correlationId: "c" }, clock);
  const types = async (userId: string) =>
    (await inbox.list(userId)).map((n) => [n.type, n.data.url]);

  it("alerts the owner at once, push off or not, and asks the other validators", async () => {
    await inbox.registerDevice(ALICE, "ExponentPushToken[alice]");
    await inbox.updatePreferences(ALICE, { push_enabled: false });
    await receive(
      envelope(
        ClaimFiled.create({
          contractId: CONTRACT,
          claimId: CLAIM,
          category: "devices",
          ownerId: ALICE,
          claimantId: BOB,
          validatorIds: [BOB, CAROL],
          contestUntil: "2026-10-21T10:00:00.000Z",
        }),
      ),
    );
    const [owner] = await inbox.list(ALICE);
    expect(owner).toMatchObject({
      type: "claim_filed_owner",
      body: "Une transmission de votre contrat « Appareils » a été demandée. Si vous êtes là, annulez-la dans l'app.",
      data: { url: `/contract/${CONTRACT}` },
    });
    expect((await deliveries()).map((d) => d.token)).toEqual([
      "ExponentPushToken[alice]",
    ]);
    expect(await types(CAROL)).toEqual([
      ["claim_filed_validator", `/contract/${CONTRACT}`],
    ]);
    // The claimant, a validator here, is not asked about their own claim.
    expect(await inbox.list(BOB)).toEqual([]);
  });

  it("tells everyone but whoever closed the claim", async () => {
    await receive(
      envelope(
        ClaimClosed.create({
          contractId: CONTRACT,
          claimId: CLAIM,
          category: "networks",
          reason: "cancelled",
          closedBy: ALICE,
          ownerId: ALICE,
          claimantId: BOB,
          validatorIds: [CAROL],
        }),
      ),
    );
    expect(await inbox.list(ALICE)).toEqual([]);
    expect((await inbox.list(BOB))[0].body).toBe(
      "Le propriétaire a annulé la demande de transmission (« Réseaux sociaux »).",
    );
    expect(await types(CAROL)).toHaveLength(1);
  });

  it("reminds the owner (critical) and the validators who have not decided", async () => {
    await receive(
      envelope(
        ClaimReminder.create({
          contractId: CONTRACT,
          claimId: CLAIM,
          category: "devices",
          ownerId: ALICE,
          pendingValidatorIds: [CAROL],
          quorum: true,
          contestUntil: "2026-10-21T10:00:00.000Z",
        }),
      ),
    );
    expect(await inbox.list(ALICE)).toMatchObject([
      { type: "claim_reminder_owner", title: "Dernier rappel" },
    ]);
    expect(await types(CAROL)).toEqual([
      ["claim_reminder_validator", `/contract/${CONTRACT}`],
    ]);
    expect(await inbox.list(BOB)).toEqual([]);
  });

  it("tells the accessor and the validators when the owner's account is gone", async () => {
    await receive(
      envelope(
        ContractRevoked.create({
          contractId: CONTRACT,
          category: "networks",
          reason: "account_deleted",
          ownerId: ALICE,
          accessorId: BOB,
          validatorIds: [CAROL],
        }),
      ),
    );
    expect((await inbox.list(BOB))[0].body).toBe(
      "Le propriétaire a supprimé son compte : le contrat « Réseaux sociaux » est révoqué.",
    );
    expect(await types(CAROL)).toEqual([
      ["contract_revoked", `/contract/${CONTRACT}`],
    ]);
  });

  it("tells the owner to re-seal when the accessor deleted their account", async () => {
    await receive(
      envelope(
        ParticipantLeft.create({
          contractId: CONTRACT,
          category: "devices",
          ownerId: ALICE,
          role: "accessor",
        }),
      ),
    );
    expect(await inbox.list(ALICE)).toMatchObject([
      { type: "participant_left", title: "Accesseur parti" },
    ]);
  });

  it("tells the accessor they can open the contract", async () => {
    await receive(
      envelope(
        ContractReleased.create({
          contractId: CONTRACT,
          claimId: CLAIM,
          category: "storage",
          ownerId: ALICE,
          accessorId: BOB,
          validatorIds: [CAROL],
        }),
      ),
    );
    expect(await types(BOB)).toEqual([
      ["contract_released", `/contract/${CONTRACT}`],
    ]);
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
    expect(await inbox.preferences(BOB)).toEqual({
      push_enabled: true,
      email_enabled: true,
      language: "fr",
      time_zone: "Europe/Paris",
    });
    const { rows } = await sql<{
      user_id: string;
    }>`select user_id from notify.push_tokens`.execute(db);
    expect(rows).toEqual([{ user_id: ALICE }]);
  });

  it("forgets the user's address and name, and the e-mails not sent yet", async () => {
    await receive(profile(ALICE, "Alice", "alice@mail.fr"));
    await receive(profile(BOB, "Bob", "bob@mail.fr"));
    await receive(aliceAddsBob());
    expect(await emailRows()).toHaveLength(1);

    await receive(
      createEnvelope(
        UserDeleted.create({ userId: BOB }),
        { correlationId: "c" },
        clock,
      ),
    );

    const { rows } = await sql<{
      user_id: string;
    }>`select user_id, email, first_name, deleted from notify.people order by user_id`.execute(
      db,
    );
    expect(rows).toEqual([
      {
        user_id: ALICE,
        email: "alice@mail.fr",
        first_name: "Alice",
        deleted: false,
      },
      { user_id: BOB, email: null, first_name: null, deleted: true },
    ]);
    expect(await emailRows()).toEqual([]);

    // A profile event sent before the deletion, retried after it, does not bring the address back.
    clock.advance(-60_000);
    await receive(profile(BOB, "Bob", "bob@mail.fr"));
    expect(await stores.root.people.getMany([BOB])).toEqual(new Map());
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
      emails: 0,
      forgotten: 0,
    });
    clock.advance(2 * 86_400_000);
    expect(await events.retention(stores.root)).toEqual({
      notifications: 0,
      deliveries: 1,
      emails: 0,
      forgotten: 0,
    });

    clock.advance(60 * 86_400_000);
    expect(await events.retention(stores.root)).toEqual({
      notifications: 1,
      deliveries: 0,
      emails: 0,
      forgotten: 0,
    });
  });

  it("deletes what is left of an account a month after it was deleted", async () => {
    await receive(profile(BOB, "Bob", "bob@mail.fr"));
    await receive(
      createEnvelope(
        UserDeleted.create({ userId: BOB }),
        { correlationId: "c" },
        clock,
      ),
    );
    clock.advance(29 * 86_400_000);
    expect((await events.retention(stores.root)).forgotten).toBe(0);
    clock.advance(2 * 86_400_000);
    expect((await events.retention(stores.root)).forgotten).toBe(1);
  });

  it("deletes the e-mails sent more than 30 days ago", async () => {
    await receive(profile(BOB, "Bob", "bob@mail.fr"));
    await receive(aliceAddsBob());
    await emailDelivery.sendDue(logger);

    clock.advance(29 * 86_400_000);
    expect((await events.retention(stores.root)).emails).toBe(0);
    clock.advance(2 * 86_400_000);
    expect((await events.retention(stores.root)).emails).toBe(1);
  });
});

describe("e-mail", () => {
  const CONTRACT = "5d2f7a10-8c3e-4b6a-9f21-0a1b2c3d4e5f";
  const CLAIM = "9b1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e";

  it("writes to the recipient's address, in their language, naming who acted", async () => {
    await receive(
      profile(ALICE, "Alice", "alice@mail.fr"),
      profile(BOB, "Bob", "bob@mail.fr", "Durand"),
    );
    await receive(aliceAddsBob());
    const [row] = await emailRows();
    expect(row).toMatchObject({
      notification_id: (await inbox.list(BOB))[0].id,
      to_address: "bob@mail.fr",
      status: "pending",
      attempts: 0,
      content: {
        language: "fr",
        critical: false,
        subject: "Alice Martin vous a ajouté à ses proches",
        greetingName: "Bob",
      },
    });
    expect(row.content.paragraphs[0]).toBe(
      "Alice Martin vous a ajouté à ses proches sur BehyndMe.",
    );
  });

  it("gives the owner who asked, and the deadline to cancel in their own time zone", async () => {
    await receive(
      profile(ALICE, "Alice", "alice@mail.fr"),
      profile(BOB, "Bob", "bob@mail.fr", "Durand"),
    );
    await inbox.updatePreferences(ALICE, { time_zone: "America/Montreal" });
    await receive(
      createEnvelope(
        ClaimFiled.create({
          contractId: CONTRACT,
          claimId: CLAIM,
          category: "networks",
          ownerId: ALICE,
          claimantId: BOB,
          validatorIds: [BOB],
          contestUntil: "2026-10-21T10:00:00.000Z",
        }),
        { correlationId: "c" },
        clock,
      ),
    );
    const [row] = await emailRows();
    expect(row.to_address).toBe("alice@mail.fr");
    expect(row.content).toMatchObject({
      critical: true,
      subject: "Demande de transmission : « Réseaux sociaux »",
      greetingName: "Alice",
    });
    expect(row.content.paragraphs[0]).toBe(
      "Bob Durand a demandé la transmission de votre contrat « Réseaux sociaux », le mercredi 14 octobre 2026 à 06:00 (UTC−4).",
    );
    expect(row.content.facts).toEqual([
      { label: "Contrat", value: "Réseaux sociaux" },
      { label: "Demandée par", value: "Bob Durand" },
      {
        label: "Annulation possible jusqu'au",
        value: "mercredi 21 octobre 2026 à 06:00 (UTC−4)",
      },
    ]);
  });

  it("sends critical alerts even when e-mail is off, and not the others", async () => {
    await receive(profile(BOB, "Bob", "bob@mail.fr"));
    await inbox.updatePreferences(BOB, { email_enabled: false });
    await receive(aliceAddsBob());
    expect(await emailRows()).toEqual([]);

    await receive(
      createEnvelope(
        KeysTransferred.create({ userId: BOB }),
        { correlationId: "c" },
        clock,
      ),
    );
    expect(await emailRows()).toMatchObject([
      { to_address: "bob@mail.fr", content: { critical: true } },
    ]);
  });

  it("writes to nobody without a verified address, or at a domain that receives no mail", async () => {
    await receive(profile(BOB, "Bob", null));
    await receive(aliceAddsBob());
    await receive(profile(BOB, "Bob", "bob@example.com"));
    await receive(aliceAddsBob());
    expect(await inbox.list(BOB)).toHaveLength(2);
    expect(await emailRows()).toEqual([]);
  });

  it("queues nothing while no provider is configured", async () => {
    email.enabled = false;
    await receive(profile(BOB, "Bob", "bob@mail.fr"));
    await receive(aliceAddsBob());
    expect(await emailRows()).toEqual([]);
    expect(await emailDelivery.sendDue(logger)).toBe(0);
  });

  it("tells someone they were added once a day: being added again does not e-mail again", async () => {
    await receive(profile(BOB, "Bob", "bob@mail.fr"));
    await receive(aliceAddsBob());
    await receive(aliceAddsBob());
    expect(await inbox.list(BOB)).toHaveLength(2);
    expect(await emailRows()).toHaveLength(1);

    clock.advance(86_400_000 + 1);
    await receive(aliceAddsBob());
    expect(await emailRows()).toHaveLength(2);
  });

  it("sends a person ten other e-mails a day at most, and every critical alert", async () => {
    await receive(profile(BOB, "Bob", "bob@mail.fr"));
    for (let i = 0; i < 11; i++) {
      await receive(
        createEnvelope(
          TrustAdded.create({
            ownerId: `user_${i}`,
            trustedId: BOB,
            ownerName: null,
          }),
          { correlationId: "c" },
          clock,
        ),
      );
    }
    expect(await emailRows()).toHaveLength(10);

    await receive(
      createEnvelope(
        KeysTransferred.create({ userId: BOB }),
        { correlationId: "c" },
        clock,
      ),
    );
    const rows = await emailRows();
    expect(rows).toHaveLength(11);
    expect(rows.filter((r) => r.content.critical)).toHaveLength(1);
  });

  it("keeps the latest address and name the gateway gave, whatever order they come in", async () => {
    await receive(profile(BOB, "Bob", "bob@mail.fr"));
    clock.advance(60_000);
    const newer = profile(BOB, "Robert", "robert@mail.fr", "Durand");
    clock.advance(-120_000);
    const older = profile(BOB, "Bobby", "old@mail.fr");
    await receive(newer);
    await receive(older);
    expect(await stores.root.people.getMany([BOB])).toEqual(
      new Map([
        [
          BOB,
          { email: "robert@mail.fr", firstName: "Robert", lastName: "Durand" },
        ],
      ]),
    );
  });

  it("e-mails each new claim on a contract, even twice the same day", async () => {
    const CAROL = "user_carol";
    await receive(profile(CAROL, "Carol", "carol@mail.fr"));
    for (const claimId of [CLAIM, "1b1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e"]) {
      await receive(
        createEnvelope(
          ClaimFiled.create({
            contractId: CONTRACT,
            claimId,
            category: "networks",
            ownerId: ALICE,
            claimantId: BOB,
            validatorIds: [BOB, CAROL],
            contestUntil: "2026-10-21T10:00:00.000Z",
          }),
          { correlationId: "c" },
          clock,
        ),
      );
    }
    const rows = await emailRows();
    expect(rows.map((r) => r.to_address)).toEqual([
      "carol@mail.fr",
      "carol@mail.fr",
    ]);
  });

  it("names nobody whose name could carry a message: the e-mail says someone", async () => {
    await receive(
      profile(
        ALICE,
        "Support BehyndMe: call +33 1 23 45 67 89",
        "alice@mail.fr",
      ),
      profile(BOB, "Bob", "bob@mail.fr"),
    );
    await receive(aliceAddsBob());
    const [row] = await emailRows();
    expect(row.content.subject).toBe("Nouveau proche");
    expect(row.content.paragraphs[0]).toBe(
      "Quelqu'un vous a ajouté à ses proches sur BehyndMe.",
    );
  });
});

describe("e-mail delivery", () => {
  beforeEach(async () => {
    await receive(profile(BOB, "Bob", "bob@mail.fr"));
    await receive(aliceAddsBob());
  });

  it("sends each e-mail once, with a key the provider uses to drop a repeat", async () => {
    expect(await emailDelivery.sendDue(logger)).toBe(1);
    const [row] = await emailRows();
    expect(email.sent).toEqual([
      {
        to: "bob@mail.fr",
        content: row.content,
        idempotencyKey: `notification-${row.notification_id}`,
      },
    ]);
    expect(row).toMatchObject({
      status: "sent",
      attempts: 1,
      provider_id: "email-1",
      error: null,
    });
    expect(await emailDelivery.sendDue(logger)).toBe(0);
    expect(email.sent).toHaveLength(1);
  });

  it("tries again later with the same key, then gives up after five tries", async () => {
    email.next = Array.from({ length: 5 }, () => ({
      status: "retry" as const,
      error: "application_error: down",
    }));
    await emailDelivery.sendDue(logger);
    expect(await emailRows()).toMatchObject([
      {
        status: "pending",
        attempts: 1,
        error: "application_error: down",
        next_attempt_at: new Date(clock.now().getTime() + 30_000),
      },
    ]);
    expect(await emailDelivery.sendDue(logger)).toBe(0);
    for (let i = 0; i < 4; i++) {
      clock.advance(3_600_000);
      await emailDelivery.sendDue(logger);
    }
    expect(await emailRows()).toMatchObject([
      { status: "failed", attempts: 5 },
    ]);
    expect(email.sent).toHaveLength(5);
    expect(new Set(email.sent.map((e) => e.idempotencyKey)).size).toBe(1);
  });

  it("waits for the next day when the day's quota is used up, without counting a try", async () => {
    await receive(
      createEnvelope(
        KeysTransferred.create({ userId: BOB }),
        { correlationId: "c" },
        clock,
      ),
    );
    email.next = [
      { status: "quota", error: "daily_quota_exceeded: 100 a day" },
    ];
    await emailDelivery.sendDue(logger);
    expect(email.sent).toHaveLength(1);
    const midnight = new Date("2026-10-15T00:00:00Z");
    expect(await emailRows()).toMatchObject([
      { status: "pending", attempts: 0, next_attempt_at: midnight },
      { status: "pending", attempts: 0, next_attempt_at: midnight },
    ]);

    clock.advance(14 * 3_600_000);
    await emailDelivery.sendDue(logger);
    expect((await emailRows()).map((r) => r.status)).toEqual(["sent", "sent"]);
  });

  it("slows down on the provider's rate limit, without counting a try", async () => {
    email.next = [
      { status: "rate_limited", error: "rate_limit_exceeded: too many" },
    ];
    // 0: the loop waits instead of asking again at once.
    expect(await emailDelivery.sendDue(logger)).toBe(0);
    expect(await emailRows()).toMatchObject([
      {
        status: "pending",
        attempts: 0,
        next_attempt_at: new Date(clock.now().getTime() + 1_000),
      },
    ]);
  });

  it("waits an hour while the provider refuses the settings, and says so", async () => {
    email.next = [
      {
        status: "misconfigured",
        error: "validation_error: domain not verified",
      },
    ];
    logger.error.mockClear();
    expect(await emailDelivery.sendDue(logger)).toBe(0);
    expect(await emailRows()).toMatchObject([
      {
        status: "pending",
        attempts: 0,
        next_attempt_at: new Date(clock.now().getTime() + 3_600_000),
      },
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("validation_error"),
    );
    expect(logger.error.mock.calls[0][0]).not.toContain("bob@mail.fr");
  });

  it("gives up at once on an e-mail the provider refuses", async () => {
    email.next = [{ status: "rejected", error: "validation_error: bad" }];
    await emailDelivery.sendDue(logger);
    expect(await emailRows()).toMatchObject([
      { status: "failed", attempts: 1, error: "validation_error: bad" },
    ]);
  });

  it("takes back an e-mail whose sender stopped half-way, ten minutes later", async () => {
    const now = clock.now();
    // A sender takes the e-mail, then dies before sending it.
    await stores.root.emails.claimDue(
      now,
      new Date(now.getTime() + 600_000),
      10,
    );
    expect(await emailDelivery.sendDue(logger)).toBe(0);
    clock.advance(600_000);
    expect(await emailDelivery.sendDue(logger)).toBe(1);
    expect(await emailRows()).toMatchObject([{ status: "sent", attempts: 2 }]);
  });

  it("drops an e-mail it could not send within three days: its dates may be past", async () => {
    email.next = [{ status: "quota", error: "monthly_quota_exceeded: full" }];
    await emailDelivery.sendDue(logger);
    clock.advance(3 * 86_400_000 + 1);
    await emailDelivery.sendDue(logger);
    expect(await emailRows()).toMatchObject([
      { status: "failed", error: "Expired: not sent within 3 days" },
    ]);
    expect(email.sent).toHaveLength(1);
  });
});
