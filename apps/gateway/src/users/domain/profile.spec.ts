import { describe, expect, it } from "vitest";
import { type Profile, visibleTo } from "./profile.js";

const alice: Profile = {
  id: "user_alice",
  email: "alice@example.com",
  phone_number: "+33600000000",
  first_name: "Alice",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("contact details visibility", () => {
  it("shows them to the user themself", () => {
    expect(visibleTo(alice, "user_alice", false)).toEqual(alice);
  });

  it("shows them to someone the user trusts", () => {
    expect(visibleTo(alice, "user_bob", true)).toEqual(alice);
  });

  it("hides them from anyone else, without touching the stored profile", () => {
    const seen = visibleTo(alice, "user_bob", false);
    expect(seen).not.toHaveProperty("email");
    expect(seen).not.toHaveProperty("phone_number");
    expect(seen.first_name).toBe("Alice");
    expect(alice.email).toBe("alice@example.com");
  });
});
