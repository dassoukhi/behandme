import { type Kysely, sql } from "kysely";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { ConflictError, InvalidInputError, NotFoundError } from "@lib/kernel";
import { FakeClock, startTestDatabase, type TestDatabase } from "@lib/testing";
import { ClaimsService } from "./application/claims.service.js";
import { ContractsService } from "./application/contracts.service.js";
import { SealingService } from "./application/sealing.service.js";
import type { RegisteredKey, SealRequest } from "./domain/sealing.js";
import { KyselyHandoverStores } from "./infrastructure/kysely-handover.stores.js";
import { nodeSealCrypto } from "./infrastructure/node-seal-crypto.js";
import { nodeSha256 } from "./infrastructure/sha256.js";
import release from "./testing/release-v1.json" with { type: "json" };
import fixture from "./testing/seal-v1.json" with { type: "json" };

// Claims and release on the real schema (PGlite), as svc_handover: a contract sealed by the app (seal-v1)
// whose validators v1 and v3 approve with shares the app re-wrapped to the accessor (release-v1).

type Who = "owner" | "accessor" | "v1" | "v2" | "v3";
const P = fixture.participants as Record<
  Who,
  (typeof fixture.participants)["owner"]
>;
const ID = fixture.contract_id;
const OWNER = P.owner.user_id;
const ACCESSOR = P.accessor.user_id;
const [V1, V2, V3] = [P.v1.user_id, P.v2.user_id, P.v3.user_id];
const b = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));
const FILED = new Date("2026-10-16T09:00:00Z");
const DAY = 86_400_000;

let t: TestDatabase;
let db: Kysely<any>;
let clock: FakeClock;
let stores: KyselyHandoverStores;
let claims: ClaimsService;
let contracts: ContractsService;

beforeAll(async () => {
  t = await startTestDatabase();
  db = t.db;
}, 60_000);
afterAll(() => t?.close());

const registered = (
  who: Who,
  usableFrom = new Date("2026-10-01T00:00:00Z"),
): RegisteredKey => ({
  keyVersion: P[who].key_version,
  fingerprint: P[who].fingerprint,
  signingPublicKey: b(P[who].signing_public_key),
  usableFrom,
});

beforeEach(async () => {
  await sql`reset role`.execute(db);
  await sql`delete from handover.contracts`.execute(db);
  await sql`delete from handover.outbox`.execute(db);
  await sql`insert into handover.contracts (id, owner_id, category) values (${ID}::uuid, ${OWNER}, 'networks')`.execute(
    db,
  );
  await sql`insert into handover.participants (contract_id, user_id, role, position) values
    (${ID}::uuid, ${ACCESSOR}, 'accessor', 0),
    (${ID}::uuid, ${V1}, 'validator', 0),
    (${ID}::uuid, ${V2}, 'validator', 1),
    (${ID}::uuid, ${V3}, 'validator', 2)`.execute(db);
  await sql`set role svc_handover`.execute(db);
  clock = new FakeClock(new Date("2026-10-15T12:00:00Z"));
  stores = new KyselyHandoverStores(db);
  claims = new ClaimsService(stores, clock, null);
  contracts = new ContractsService(stores, nodeSha256, clock);
  const s = fixture.sealed;
  const request: SealRequest = {
    expectedVersion: 1,
    accessorId: ACCESSOR,
    validatorIds: [V1, V2, V3],
    envelope: b(s.envelope),
    ownerWrap: b(s.owner_wrap),
    shares: s.shares.map((x) => ({
      userId: x.user_id,
      index: x.index,
      keyVersion: x.key_version,
      wrap: b(x.wrap),
    })),
    manifest: structuredClone(s.manifest),
    manifestSignature: b(s.manifest_signature),
  };
  const keys = new Map(
    (Object.keys(P) as Who[]).map((who) => [P[who].user_id, registered(who)]),
  );
  await new SealingService(stores, nodeSealCrypto, clock).seal(
    OWNER,
    ID,
    request,
    keys,
  );
  clock.advance(FILED.getTime() - clock.now().getTime());
});
afterEach(() => sql`reset role`.execute(db));

/** The approval the app made for validator `who` (release-v1.json). */
const approval = (who: "v1" | "v3") => {
  const a = release.approvals.find((x) => x.user_id === P[who].user_id)!;
  return {
    approve: true,
    releaseWrap: b(a.release_wrap),
    accessorKeyVersion: a.accessor_key_version,
  };
};
const approveAs = (who: "v1" | "v3", claimId: string) =>
  claims.decide(
    P[who].user_id,
    ID,
    claimId,
    approval(who),
    registered("accessor"),
  );
const rejectAs = (userId: string, claimId: string) =>
  claims.decide(
    userId,
    ID,
    claimId,
    { approve: false },
    registered("accessor"),
  );
const settle = (claimId: string) =>
  stores.transaction((store) => claims.settle(store, claimId));

/** Events in handover's outbox, oldest first. */
async function outbox() {
  await sql`reset role`.execute(db);
  const { rows } = await sql<{
    type: string;
    envelope: { payload: Record<string, unknown> };
    deliver_at: Date | null;
  }>`select type, envelope, deliver_at from handover.outbox order by id`.execute(
    db,
  );
  await sql`set role svc_handover`.execute(db);
  return rows;
}

async function file(by = ACCESSOR) {
  const record = await claims.file(by, ID);
  return record.open_claim!.id;
}

describe("filing a claim", () => {
  it("claims the contract, alerts through the outbox, and schedules the deadline", async () => {
    const record = await claims.file(ACCESSOR, ID);
    expect(record).toMatchObject({
      status: "claimed",
      allowed_actions: ["withdraw_claim"],
      open_claim: {
        claimant_id: ACCESSOR,
        status: "open",
        contest_until: "2026-10-23T09:00:00.000Z",
        approvals: 0,
        threshold: 2,
        my_decision: null,
      },
    });
    expect((await contracts.get(OWNER, ID)).allowed_actions).toEqual([
      "revoke",
      "cancel_claim",
    ]);
    expect((await contracts.get(V2, ID)).allowed_actions).toEqual(["decide"]);

    const events = await outbox();
    expect(events.map((e) => e.type)).toEqual([
      "claim.filed",
      "claim.deadline_due",
    ]);
    expect(events[0].envelope.payload).toMatchObject({
      contractId: ID,
      category: "networks",
      ownerId: OWNER,
      claimantId: ACCESSOR,
      validatorIds: [V1, V2, V3],
    });
    expect(events[1].deliver_at?.toISOString()).toBe(
      "2026-10-23T09:00:00.000Z",
    );
    expect((await contracts.events(OWNER, ID)).at(-1)?.type).toBe(
      "claim.filed",
    );
  });

  it("is refused to the owner, on a draft, and while another claim is open", async () => {
    await expect(claims.file(OWNER, ID)).rejects.toThrow(NotFoundError);
    await file();
    await expect(claims.file(V1, ID)).rejects.toThrow(ConflictError);
  });
});

describe("release", () => {
  it("waits for the contest window with two approvals, then gives the accessor the re-wrapped shares", async () => {
    const claimId = await file();
    await approveAs("v1", claimId);
    const record = await approveAs("v3", claimId);
    expect(record).toMatchObject({
      status: "claimed",
      open_claim: { approvals: 2, my_decision: "approve" },
    });
    expect((await outbox()).map((e) => e.type)).toContain(
      "claim.quorum_reached",
    );
    await expect(claims.releasePackage(ACCESSOR, ID)).rejects.toThrow(
      ConflictError,
    );

    expect(await settle(claimId)).toBe("wait");
    clock.advance(7 * DAY);
    expect(await settle(claimId)).toBe("release");

    expect(await contracts.get(ACCESSOR, ID)).toMatchObject({
      status: "released",
      allowed_actions: ["open"],
      open_claim: null,
    });
    const pack = await claims.releasePackage(ACCESSOR, ID);
    expect(pack).toMatchObject({
      sealed_version: 1,
      claim_id: claimId,
      envelope: fixture.sealed.envelope,
      manifest_signature: fixture.sealed.manifest_signature,
    });
    expect(pack.shares).toEqual(
      release.approvals.map((a) => ({
        index: a.index,
        key_version: 1,
        wrap: a.release_wrap,
      })),
    );
    for (const other of [OWNER, V1]) {
      await expect(claims.releasePackage(other, ID)).rejects.toThrow(
        NotFoundError,
      );
    }
    const types = (await outbox()).map((e) => e.type);
    expect(types.at(-1)).toBe("contract.released");
    expect((await contracts.events(OWNER, ID)).at(-1)?.type).toBe(
      "contract.released",
    );
  });

  it("releases at once when the quorum comes after the contest window", async () => {
    const claimId = await file();
    await approveAs("v1", claimId);
    clock.advance(8 * DAY);
    expect((await approveAs("v3", claimId)).status).toBe("released");
  });

  it("is caught up by the hourly tick when the deadline message went missing, and expires unanswered claims", async () => {
    const claimId = await file();
    await approveAs("v1", claimId);
    clock.advance(61 * DAY);
    const result = await stores.transaction((store) => claims.settleDue(store));
    expect(result).toEqual({ released: 0, expired: 1 });
    expect((await contracts.get(OWNER, ID)).status).toBe("active");
    expect(await settle(claimId)).toBe("closed");
  });
});

describe("ending a claim without release", () => {
  async function wrapsLeft() {
    await sql`reset role`.execute(db);
    const { rows } =
      await sql`select 1 from handover.decisions where release_wrap is not null`.execute(
        db,
      );
    await sql`set role svc_handover`.execute(db);
    return rows.length;
  }

  it("closes when k approvals are out of reach, and erases the shares already re-wrapped", async () => {
    const claimId = await file();
    await approveAs("v1", claimId);
    expect(await wrapsLeft()).toBe(1);
    await rejectAs(V2, claimId);
    const record = await rejectAs(V3, claimId);
    expect(record).toMatchObject({ status: "active", open_claim: null });
    expect(await wrapsLeft()).toBe(0);
    const closed = (await outbox()).find((e) => e.type === "claim.closed");
    expect(closed?.envelope.payload).toMatchObject({
      reason: "rejected",
      closedBy: null,
    });
  });

  it('lets the owner cancel ("I\'m here"), then makes the claimant wait 72 hours', async () => {
    const claimId = await file();
    await approveAs("v1", claimId);
    expect(await claims.cancel(OWNER, ID, claimId)).toMatchObject({
      status: "active",
    });
    expect(await wrapsLeft()).toBe(0);
    const accessorView = await contracts.get(ACCESSOR, ID);
    expect(accessorView.allowed_actions).toEqual([]);
    expect(accessorView.claim_cooldown_until).toBe("2026-10-19T09:00:00.000Z");
    await expect(claims.file(ACCESSOR, ID)).rejects.toThrow(ConflictError);
    // Another participant may claim at once; the claimant after 72 hours.
    expect((await claims.file(V2, ID)).status).toBe("claimed");
  });

  it("lets only the claimant withdraw", async () => {
    const claimId = await file(V1);
    await expect(claims.withdraw(ACCESSOR, ID, claimId)).rejects.toThrow(
      ConflictError,
    );
    expect((await claims.withdraw(V1, ID, claimId)).status).toBe("active");
    // Withdrawing is not a refusal by the owner: no waiting.
    expect((await claims.file(V1, ID)).status).toBe("claimed");
  });

  it("ends with the contract when the owner revokes it", async () => {
    const claimId = await file();
    await approveAs("v1", claimId);
    await claimsRevoke();
    expect(await wrapsLeft()).toBe(0);
    const closed = (await outbox()).find((e) => e.type === "claim.closed");
    expect(closed?.envelope.payload).toMatchObject({
      reason: "revoked",
      closedBy: OWNER,
    });
  });
});

async function claimsRevoke() {
  const version = (await contracts.get(OWNER, ID)).version;
  await new SealingService(stores, nodeSealCrypto, clock).revoke(
    OWNER,
    ID,
    version,
  );
}

describe("decisions", () => {
  it("are taken once, by validators only", async () => {
    const claimId = await file();
    await rejectAs(V2, claimId);
    await expect(rejectAs(V2, claimId)).rejects.toThrow(ConflictError);
    for (const other of [OWNER, ACCESSOR]) {
      await expect(rejectAs(other, claimId)).rejects.toThrow(NotFoundError);
    }
    await expect(rejectAs("user_stranger", claimId)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("refuse an approval without its re-wrapped share, or wrapped to the accessor's old keys", async () => {
    const claimId = await file();
    await expect(
      claims.decide(V1, ID, claimId, { approve: true }, registered("accessor")),
    ).rejects.toThrow(InvalidInputError);
    await expect(
      claims.decide(V1, ID, claimId, approval("v1"), {
        ...registered("accessor"),
        keyVersion: 2,
      }),
    ).rejects.toThrow(ConflictError);
    expect((await contracts.get(V1, ID)).allowed_actions).toEqual(["decide"]);
  });

  it("are refused on a claim that is no longer open", async () => {
    const claimId = await file();
    await claims.cancel(OWNER, ID, claimId);
    await expect(rejectAs(V2, claimId)).rejects.toThrow(ConflictError);
  });
});
