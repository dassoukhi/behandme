import { beforeEach, describe, expect, it } from "vitest";
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  SECRET_TOKEN_PATTERN,
  secretTokenHash,
} from "@lib/kernel";
import { FakeClock } from "@lib/testing";
import {
  INVITATION_TTL_MS,
  MAX_PENDING_INVITATIONS,
} from "../domain/invitation.js";
import { InMemoryUsers } from "../testing/in-memory-ports.js";
import { InvitationService } from "./invitation.service.js";
import { ProfileService } from "./profile.service.js";
import { TrustService } from "./trust.service.js";

let store: InMemoryUsers;
let clock: FakeClock;
let invitations: InvitationService;

beforeEach(() => {
  store = new InMemoryUsers().person("marie", "Marie").person("bruno", "Bruno");
  clock = new FakeClock();
  const trust = new TrustService(store, store, clock);
  invitations = new InvitationService(
    store.invitations,
    new ProfileService(store, store, trust, store),
    store,
    clock,
  );
});

const linked = (owner: string, trusted: string) =>
  store.links.some((l) => l.owner_id === owner && l.trusted_id === trusted);

describe("InvitationService", () => {
  it("gives the inviter a secret token once, and keeps only its hash, for seven days", async () => {
    const { invitation, token } = await invitations.create("marie");
    expect(token).toMatch(SECRET_TOKEN_PATTERN);
    expect(invitation.expiresAt.getTime() - clock.now().getTime()).toBe(
      INVITATION_TTL_MS,
    );
    expect(store.invitationRows[0].tokenHash).toBe(
      Buffer.from(secretTokenHash(token)).toString("hex"),
    );
    expect(JSON.stringify(store.invitationRows)).not.toContain(token);
  });

  it("shows the holder of the link who invites them, without their contact details", async () => {
    const { token } = await invitations.create("marie");
    const preview = await invitations.preview("bruno", token);
    expect(preview.inviter).toMatchObject({ id: "marie", first_name: "Marie" });
    expect(preview.inviter).not.toHaveProperty("email");
    expect(preview.own).toBe(false);
    expect((await invitations.preview("marie", token)).own).toBe(true);
  });

  it("makes the inviter trust the invitee on acceptance, and tells the inviter only", async () => {
    const { token } = await invitations.create("marie");
    expect(await invitations.accept("bruno", token, false)).toEqual({
      inviterId: "marie",
      trustedBack: false,
    });
    expect(linked("marie", "bruno")).toBe(true);
    expect(linked("bruno", "marie")).toBe(false);
    expect(store.published).toEqual([
      {
        type: "invitation.accepted",
        version: 1,
        payload: {
          inviterId: "marie",
          inviteeId: "bruno",
          inviteeName: "Bruno Test",
          trustedBack: false,
        },
      },
    ]);
  });

  it("lets the invitee trust the inviter back in the same step", async () => {
    const { token } = await invitations.create("marie");
    await invitations.accept("bruno", token, true);
    expect(linked("marie", "bruno")).toBe(true);
    expect(linked("bruno", "marie")).toBe(true);
    expect(store.published[0].payload).toMatchObject({ trustedBack: true });
  });

  it("says trusted back whenever the invitee trusts the inviter, from before or now", async () => {
    store.trusts("bruno", "marie");
    const { token } = await invitations.create("marie");
    expect(await invitations.accept("bruno", token, false)).toEqual({
      inviterId: "marie",
      trustedBack: true,
    });
    expect(store.links.filter((l) => l.owner_id === "bruno")).toHaveLength(1);
  });

  it("is used once: a second acceptance finds nothing", async () => {
    store.person("chloe", "Chloé");
    const { token } = await invitations.create("marie");
    await invitations.accept("bruno", token, false);
    await expect(invitations.accept("chloe", token, false)).rejects.toThrow(
      NotFoundError,
    );
    await expect(invitations.preview("chloe", token)).rejects.toThrow(
      NotFoundError,
    );
    expect(linked("marie", "chloe")).toBe(false);
    expect(store.published).toHaveLength(1);
  });

  it("stops working after seven days", async () => {
    const { token } = await invitations.create("marie");
    clock.advance(INVITATION_TTL_MS);
    await expect(invitations.preview("bruno", token)).rejects.toThrow(
      NotFoundError,
    );
    await expect(invitations.accept("bruno", token, false)).rejects.toThrow(
      NotFoundError,
    );
    expect(linked("marie", "bruno")).toBe(false);
  });

  it("stops working once the inviter cancels it, which only they can do", async () => {
    const { invitation, token } = await invitations.create("marie");
    await expect(invitations.cancel("bruno", invitation.id)).rejects.toThrow(
      NotFoundError,
    );
    await invitations.cancel("marie", invitation.id);
    await expect(invitations.accept("bruno", token, false)).rejects.toThrow(
      NotFoundError,
    );
    await expect(invitations.cancel("marie", invitation.id)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("refuses the inviter's own acceptance", async () => {
    const { token } = await invitations.create("marie");
    await expect(invitations.accept("marie", token, true)).rejects.toThrow(
      InvalidInputError,
    );
    expect(store.links).toEqual([]);
  });

  it("finds nothing for a token that is not one of ours, without a lookup", async () => {
    await expect(invitations.preview("bruno", "x")).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      invitations.accept("bruno", "a".repeat(43), false),
    ).rejects.toThrow(NotFoundError);
  });

  it("still accepts when the inviter already trusts the invitee", async () => {
    store.trusts("marie", "bruno");
    const { token } = await invitations.create("marie");
    await invitations.accept("bruno", token, false);
    expect(store.links).toHaveLength(1);
    expect(store.published).toHaveLength(1);
  });

  it("lists the inviter's pending invitations, newest first, and caps them", async () => {
    const first = await invitations.create("marie");
    clock.advance(1000);
    const second = await invitations.create("marie");
    await invitations.accept("bruno", first.token, false);
    expect((await invitations.pending("marie")).map((i) => i.id)).toEqual([
      second.invitation.id,
    ]);
    expect(await invitations.pending("bruno")).toEqual([]);

    for (let i = 1; i < MAX_PENDING_INVITATIONS; i++) {
      await invitations.create("marie");
    }
    await expect(invitations.create("marie")).rejects.toThrow(ConflictError);
  });

  it("needs a profile to invite", async () => {
    await expect(invitations.create("ghost")).rejects.toThrow(NotFoundError);
  });
});
