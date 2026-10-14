import { describe, expect, it } from "vitest";
import { InvalidInputError } from "@lib/kernel";
import { assertCanTrust } from "./trust.js";

describe("trust", () => {
  it("is refused towards oneself", () => {
    expect(() => assertCanTrust("user_alice", "user_alice")).toThrow(
      new InvalidInputError("You cannot trust yourself"),
    );
  });

  it("is allowed towards someone else", () => {
    expect(() => assertCanTrust("user_alice", "user_bob")).not.toThrow();
  });
});
