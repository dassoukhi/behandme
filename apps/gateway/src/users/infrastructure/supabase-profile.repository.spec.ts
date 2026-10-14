import { beforeEach, describe, expect, it } from "vitest";
import { fakeSupabaseService } from "../../testing/in-memory-supabase.js";
import { SupabaseProfileRepository } from "./supabase-profile.repository.js";

const person = (id: string, first_name: string, email: string) => ({
  id,
  first_name,
  last_name: "Durand",
  email,
});

let repository: SupabaseProfileRepository;

beforeEach(() => {
  repository = new SupabaseProfileRepository(
    fakeSupabaseService({
      users: [
        person("u1", "Alice", "alice.martin@example.com"),
        person("u2", "Bob", "bob@example.com"),
        person("u3", "50%_off", "promo@example.com"),
      ],
    }),
  );
});

const ids = async (term: string) =>
  (await repository.search(term, 20)).map((p) => p.id);

describe("profile search (Supabase)", () => {
  it("matches names partially, whatever the case", async () => {
    expect(await ids("ALI")).toEqual(["u1"]);
  });

  it("matches an email only when given in full, so addresses cannot be harvested", async () => {
    expect(await ids("alice.martin@")).toEqual([]);
    expect(await ids("@example.com")).toEqual([]);
    expect(await ids("Alice.Martin@Example.com")).toEqual(["u1"]);
  });

  it("treats % and _ in the query as plain characters", async () => {
    expect(await ids("%")).toEqual(["u3"]);
    expect(await ids("_")).toEqual(["u3"]);
    expect(await ids("b_b@example.com")).toEqual([]);
  });
});
