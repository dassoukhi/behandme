import { ReverificationRequired } from "../../auth/domain/reverification.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  UnprocessableError,
} from "@lib/kernel";
import { FakeClock } from "@lib/testing";
import { CONTACT_CODE_TTL_MS } from "../domain/contact-code.js";
import { InMemoryUsers } from "../testing/in-memory-ports.js";
import { ContactCodeService } from "./contact-code.service.js";
import { ProfileService } from "./profile.service.js";
import { TrustService } from "./trust.service.js";

let store: InMemoryUsers;
let profiles: ProfileService;
let trust: TrustService;
let clock: FakeClock;
let codes: ContactCodeService;

beforeEach(() => {
  store = new InMemoryUsers();
  clock = new FakeClock();
  trust = new TrustService(store, store, clock);
  profiles = new ProfileService(store, store, trust, store);
  codes = new ContactCodeService(store.contactCodes, clock);
});

describe("TrustService", () => {
  it("records that the caller trusts someone who trusts them, and tells them", async () => {
    store.person("me", "Sam").person("bob").trusts("bob", "me");
    store.profiles.get("me")!.last_name = "Durand";
    const link = await trust.add("me", "bob");
    expect(link).toMatchObject({ owner_id: "me", trusted_id: "bob" });
    expect(store.published).toEqual([
      {
        type: "trust.added",
        version: 1,
        payload: { ownerId: "me", trustedId: "bob", ownerName: "Sam Durand" },
      },
    ]);
  });

  it("names nobody in the event when the caller has no name", async () => {
    store.person("me").person("bob").trusts("bob", "me");
    Object.assign(store.profiles.get("me")!, {
      first_name: null,
      last_name: "  ",
    });
    await trust.add("me", "bob");
    expect(store.published[0].payload).toMatchObject({ ownerName: null });
  });

  it("refuses to trust oneself, an unknown user, or someone already trusted", async () => {
    store.person("me").person("bob").trusts("me", "bob").trusts("bob", "me");
    await expect(trust.add("me", "me")).rejects.toThrow(InvalidInputError);
    await expect(trust.add("me", "ghost")).rejects.toThrow(
      new NotFoundError("User with ID ghost not found"),
    );
    await expect(trust.add("me", "bob")).rejects.toThrow(
      new ConflictError("User is already trusted"),
    );
    expect(store.published).toEqual([]);
  });

  it("refuses someone who neither trusts the caller nor showed them their contact code", async () => {
    store.person("me").person("bob").person("eve");
    await expect(trust.add("me", "bob")).rejects.toThrow(
      new NotFoundError("Scan their contact code, or send them an invitation"),
    );
    // Eve's code is no proof for Bob, nor a token that is not one of ours.
    const { token } = await codes.issue("eve");
    await expect(trust.add("me", "bob", token)).rejects.toThrow(NotFoundError);
    await expect(trust.add("me", "bob", "not-a-token")).rejects.toThrow(
      NotFoundError,
    );
    expect(store.links).toEqual([]);
    expect(store.published).toEqual([]);
  });

  it("adds someone whose contact code the caller scanned, while it is valid", async () => {
    store.person("me").person("bob").person("eve");
    const { token } = await codes.issue("bob");
    await trust.add("me", "bob", token);
    expect(await trust.trustedIds("me")).toEqual(new Set(["bob"]));

    const eve = await codes.issue("eve");
    clock.advance(CONTACT_CODE_TTL_MS);
    await expect(trust.add("me", "eve", eve.token)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("stops trusting someone, and says when there was no link", async () => {
    store.person("me").person("bob").trusts("me", "bob").trusts("bob", "me");
    await trust.remove("me", "bob");
    expect(await trust.trustedIds("me")).toEqual(new Set());
    expect(await trust.trustedIds("bob")).toEqual(new Set(["me"]));
    await expect(trust.remove("me", "bob")).rejects.toThrow(
      new NotFoundError("User with ID bob is not trusted"),
    );
  });

  it("lists the users who trust the caller, with their contact details", async () => {
    store.person("me").person("bob").person("eve").trusts("bob", "me");
    const listed = await trust.listTrustedBy("me");
    expect(listed.map((p) => p.id)).toEqual(["bob"]);
    expect(listed[0].email).toBe("bob@example.com");
  });

  it("lists trusted users with contact details only for those who trust the caller back", async () => {
    store
      .person("me")
      .person("bob")
      .person("eve")
      .trusts("me", "bob")
      .trusts("me", "eve")
      .trusts("bob", "me");

    const listed = await trust.listTrusted("me");

    expect(listed.find((p) => p.id === "bob")?.email).toBe("bob@example.com");
    expect(listed.find((p) => p.id === "eve")).not.toHaveProperty("email");
  });

  it("never counts the caller among the users who trust them", async () => {
    store.person("me").trusts("me", "me");
    expect(await trust.whoTrusts("me", ["me"])).toEqual(new Set());
  });
});

describe("ProfileService", () => {
  describe("ensureMe", () => {
    const identity = (email: string | null) => ({
      email,
      email_verified: true,
      first_name: "Nina",
      last_name: "Nouvelle",
      avatar_url: null,
    });

    it("creates the profile from the verified identity, then syncs it", async () => {
      store.identities.set("me", identity("nina@example.com"));
      expect((await profiles.ensureMe("me")).created).toBe(true);

      store.identities.set("me", identity("nina.new@example.com"));
      const { profile, created } = await profiles.ensureMe("me", {
        first_name: "Nina-Rose",
      });

      expect(created).toBe(false);
      expect(profile).toMatchObject({
        email: "nina.new@example.com",
        first_name: "Nina-Rose",
        last_name: "Nouvelle",
      });
    });

    it("never takes the email from the caller", async () => {
      store.identities.set("me", identity("nina@example.com"));
      const forged = { first_name: "Nina", email: "boss@example.com" };

      const { profile } = await profiles.ensureMe("me", forged as never);

      expect(profile.email).toBe("nina@example.com");
    });

    it("writes nothing for an account without a verified email", async () => {
      store.identities.set("me", identity(null));
      await expect(profiles.ensureMe("me")).rejects.toThrow(UnprocessableError);
      expect(store.profiles.size).toBe(0);
      expect(store.published).toEqual([]);
    });

    it("tells the notifier the address and name at every sync", async () => {
      store.identities.set("me", identity("nina@example.com"));
      await profiles.ensureMe("me");
      await profiles.ensureMe("me", { last_name: "Durand" });
      const event = (lastName: string) => ({
        type: "user.profile_changed",
        version: 1,
        payload: {
          userId: "me",
          email: "nina@example.com",
          firstName: "Nina",
          lastName,
        },
      });
      expect(store.published).toEqual([event("Nouvelle"), event("Durand")]);
    });

    it("accepts any address Clerk verified, even one a strict pattern would refuse", async () => {
      store.identities.set("me", identity("nina@exemple.xn--p1ai"));
      await expect(profiles.ensureMe("me")).resolves.toMatchObject({
        created: true,
      });
      expect(store.published[0].payload).toMatchObject({
        email: "nina@exemple.xn--p1ai",
      });
    });
  });

  it("answers 'not found' for a missing profile, whatever the operation", async () => {
    await expect(profiles.findMe("me")).rejects.toThrow(
      new NotFoundError("Profile not found"),
    );
    await expect(
      profiles.updateMe("me", { phone_number: "+1" }),
    ).rejects.toThrow(NotFoundError);
    expect(store.published).toEqual([]);
    await expect(profiles.findOne("me", "ghost")).rejects.toThrow(
      new NotFoundError("User with ID ghost not found"),
    );
  });

  const FRESH: [number, number] = [2, -1];

  it("asks Clerk's reverification before deleting anything", async () => {
    store.person("me");
    await expect(profiles.removeMe("me", null)).rejects.toThrow(
      ReverificationRequired,
    );
    await expect(profiles.removeMe("me", [11, -1])).rejects.toThrow(
      ReverificationRequired,
    );
    expect(store.profiles.has("me")).toBe(true);
    expect(store.published).toEqual([]);
    expect(store.deletedUsers).toEqual([]);
  });

  it("deletes the profile, tells the other services, then deletes the Clerk account", async () => {
    store.person("me");
    await profiles.removeMe("me", FRESH);
    expect(store.profiles.has("me")).toBe(false);
    expect(store.published).toEqual([
      { type: "user.deleted", version: 1, payload: { userId: "me" } },
    ]);
    expect(store.deletedUsers).toEqual(["me"]);
  });

  it("finishes a deletion interrupted at Clerk without telling the services twice", async () => {
    await profiles.removeMe("me", FRESH);
    expect(store.published).toEqual([]);
    expect(store.deletedUsers).toEqual(["me"]);
  });

  it("closes an account for support as its owner would delete it, with no session to reverify", async () => {
    store.person("heir-request");
    await profiles.closeAccount("heir-request");
    expect(store.profiles.has("heir-request")).toBe(false);
    expect(store.published).toEqual([
      { type: "user.deleted", version: 1, payload: { userId: "heir-request" } },
    ]);
    expect(store.deletedUsers).toEqual(["heir-request"]);
  });

  it("finds the account to close by its id, or by its e-mail address whatever its case", async () => {
    store.person("me");
    store.profiles.get("me")!.email = "nina.martin@example.com";
    expect((await profiles.findAccount("me"))?.id).toBe("me");
    expect((await profiles.findAccount(" Nina.Martin@Example.com "))?.id).toBe(
      "me",
    );
    expect(await profiles.findAccount("someone@example.com")).toBeNull();
    expect(await profiles.findAccount("ghost")).toBeNull();
  });
});
