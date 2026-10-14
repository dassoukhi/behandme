import { beforeEach, describe, expect, it } from "vitest";
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  UnprocessableError,
} from "@lib/kernel";
import { InMemoryUsers } from "../testing/in-memory-ports.js";
import { ProfileService } from "./profile.service.js";
import { TrustService } from "./trust.service.js";

let store: InMemoryUsers;
let profiles: ProfileService;
let trust: TrustService;

beforeEach(() => {
  store = new InMemoryUsers();
  trust = new TrustService(store, store);
  profiles = new ProfileService(store, store, trust, store, store);
});

describe("TrustService", () => {
  it("records that the caller trusts someone, and tells them", async () => {
    store.person("me", "Sam").person("bob");
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
    store.person("me").person("bob");
    Object.assign(store.profiles.get("me")!, {
      first_name: null,
      last_name: "  ",
    });
    await trust.add("me", "bob");
    expect(store.published[0].payload).toMatchObject({ ownerName: null });
  });

  it("refuses to trust oneself, an unknown user, or someone already trusted", async () => {
    store.person("me").person("bob").trusts("me", "bob");
    await expect(trust.add("me", "me")).rejects.toThrow(InvalidInputError);
    await expect(trust.add("me", "ghost")).rejects.toThrow(
      new NotFoundError("User with ID ghost not found"),
    );
    await expect(trust.add("me", "bob")).rejects.toThrow(
      new ConflictError("User is already trusted"),
    );
    expect(store.published).toEqual([]);
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
    });
  });

  it("answers 'not found' for a missing profile, whatever the operation", async () => {
    await expect(profiles.findMe("me")).rejects.toThrow(
      new NotFoundError("Profile not found"),
    );
    await expect(
      profiles.updateMe("me", { phone_number: "+1" }),
    ).rejects.toThrow(NotFoundError);
    await expect(profiles.removeMe("me")).rejects.toThrow(NotFoundError);
    expect(store.published).toEqual([]);
    await expect(profiles.findOne("me", "ghost")).rejects.toThrow(
      new NotFoundError("User with ID ghost not found"),
    );
  });

  it("refuses to delete someone who takes part in another's contract", async () => {
    store.person("me");
    store.participants.add("me");
    await expect(profiles.removeMe("me")).rejects.toThrow(ConflictError);
    expect(store.profiles.has("me")).toBe(true);
    expect(store.published).toEqual([]);
  });

  it("deletes the caller's profile and tells the other services", async () => {
    store.person("me");
    await profiles.removeMe("me");
    expect(store.profiles.has("me")).toBe(false);
    expect(store.published).toEqual([
      { type: "user.deleted", version: 1, payload: { userId: "me" } },
    ]);
  });

  describe("search", () => {
    it("refuses an empty query", async () => {
      await expect(profiles.search("me", "  ")).rejects.toThrow(
        new InvalidInputError("Search query cannot be empty"),
      );
    });

    it("leaves out the caller and the users they already trust, sorted by first name", async () => {
      store
        .person("me", "Martin")
        .person("u1", "Marc")
        .person("u2", "Mar")
        .person("u3", "Maria")
        .trusts("me", "u3");

      const found = await profiles.search("me", "mar");

      expect(found.map((p) => p.id)).toEqual(["u2", "u1"]);
    });

    it("lists a user matched several ways once, and applies the visibility rule", async () => {
      store.person("me").person("bob", "Test");

      const found = await profiles.search("me", "test");

      expect(found.map((p) => p.id)).toEqual(["bob"]);
      expect(found[0]).not.toHaveProperty("email");
    });

    it("returns at most 20 users, even when first and last names each give 15", async () => {
      store.person("me");
      for (let i = 0; i < 15; i++) store.person(`first${i}`, `Sam${i}`);
      for (let i = 0; i < 15; i++) {
        store.person(`last${i}`, `Zoe${i}`);
        store.profiles.get(`last${i}`)!.last_name = "Samson";
      }
      expect(await profiles.search("me", "sam")).toHaveLength(20);
    });
  });
});
