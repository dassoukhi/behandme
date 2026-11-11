import { describe, expect, it } from "vitest";
import {
  acceptableProofDay,
  backedUpByPasskey,
  careReminder,
  type KeyCare,
  phraseCheckDue,
  phraseCheckDueAt,
  phraseScheduleDueAt,
  validatorKeyState,
} from "./domain/care.js";

const at = (iso: string) => new Date(iso);
const care = (changes: Partial<KeyCare> = {}): KeyCare => ({
  userId: "user_a",
  keyVersion: 1,
  fingerprint: "a",
  createdAt: at("2026-03-01T10:00:00Z"),
  provenOn: null,
  phraseCheckedAt: null,
  phraseChecks: 0,
  phraseLocation: null,
  remindedAt: null,
  passkeyBackup: null,
  ...changes,
});

describe("the day of a proof", () => {
  const now = at("2026-06-15T23:30:00Z");

  it.each(["2026-06-15", "2026-06-14", "2026-06-16"])("accepts %s", (day) => {
    expect(acceptableProofDay(day, now)).toBe(true);
  });

  it.each(["2026-06-13", "2026-06-17", "2026-02-31", "15/06/2026", ""])(
    "refuses %s",
    (day) => {
      expect(acceptableProofDay(day, now)).toBe(false);
    },
  );
});

describe("checks of the phrase", () => {
  const checked = at("2026-03-01T10:00:00Z");

  it("are not due before the user proved they kept it", () => {
    expect(phraseScheduleDueAt(care())).toBeNull();
    expect(phraseCheckDue(care(), at("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it.each([
    [1, "2026-03-08T10:00:00.000Z"],
    [2, "2026-03-31T10:00:00.000Z"],
    [3, "2026-08-28T10:00:00.000Z"],
    [4, "2027-01-01T00:00:00.000Z"],
    [9, "2027-01-01T00:00:00.000Z"],
  ])("after proof number %i, fall due on %s", (phraseChecks, due) => {
    const c = care({ phraseCheckedAt: checked, phraseChecks });
    expect(phraseScheduleDueAt(c)?.toISOString()).toBe(due);
    expect(phraseCheckDue(c, at(due))).toBe(true);
    expect(phraseCheckDue(c, new Date(at(due).getTime() - 1))).toBe(false);
  });

  it("leave a month after a proof made just before the new year", () => {
    const c = care({
      phraseCheckedAt: at("2026-12-20T10:00:00Z"),
      phraseChecks: 4,
    });
    expect(phraseScheduleDueAt(c)?.toISOString()).toBe(
      "2027-01-19T10:00:00.000Z",
    );
  });
});

describe("reminders", () => {
  const proven = at("2026-11-02T00:00:00Z");
  const quietly = { provenOn: at("2027-01-02T00:00:00Z") };

  it("say nothing to someone with nothing due", () => {
    expect(careReminder(care(), at("2026-06-01T00:00:00Z"))).toBeNull();
    expect(
      careReminder(care({ provenOn: proven }), at("2026-12-20T00:00:00Z")),
    ).toBeNull();
  });

  it("remind once of a phrase check that fell due", () => {
    const c = care({
      phraseCheckedAt: at("2026-03-01T10:00:00Z"),
      phraseChecks: 1,
    });
    expect(careReminder(c, at("2026-03-08T09:59:00Z"))).toBeNull();
    expect(careReminder(c, at("2026-03-08T10:00:00Z"))).toBe("phrase_check");
    const reminded = { ...c, remindedAt: at("2026-03-08T10:00:00Z") };
    expect(careReminder(reminded, at("2026-05-01T00:00:00Z"))).toBeNull();
  });

  it("ask for the yearly check-up twice at most, in January, of someone silent this year", () => {
    const c = care({ provenOn: proven });
    expect(careReminder(c, at("2027-01-03T08:00:00Z"))).toBe("key_checkup");
    const first = { ...c, remindedAt: at("2027-01-03T08:00:00Z") };
    expect(careReminder(first, at("2027-01-15T08:00:00Z"))).toBeNull();
    expect(careReminder(first, at("2027-01-16T08:00:00Z"))).toBe("key_checkup");
    const second = { ...c, remindedAt: at("2027-01-16T08:00:00Z") };
    expect(careReminder(second, at("2027-01-31T08:00:00Z"))).toBeNull();
    expect(careReminder(second, at("2027-02-01T08:00:00Z"))).toBeNull();
  });

  it("leave alone a phone that gave a sign this year, or keys made a few days ago", () => {
    expect(careReminder(care(quietly), at("2027-01-20T08:00:00Z"))).toBeNull();
    expect(
      careReminder(
        care({ createdAt: at("2026-12-20T10:00:00Z") }),
        at("2027-01-05T08:00:00Z"),
      ),
    ).toBeNull();
  });

  it("ask again, each January, for a phrase check still overdue on a phone in use", () => {
    const c = care({
      provenOn: at("2028-01-05T00:00:00Z"),
      phraseCheckedAt: at("2026-03-01T10:00:00Z"),
      phraseChecks: 1,
      remindedAt: at("2026-03-08T10:00:00Z"),
    });
    expect(careReminder(c, at("2027-06-01T08:00:00Z"))).toBeNull();
    expect(careReminder(c, at("2028-01-10T08:00:00Z"))).toBe("phrase_check");
    const asked = { ...c, remindedAt: at("2028-01-10T08:00:00Z") };
    expect(careReminder(asked, at("2028-01-15T08:00:00Z"))).toBeNull();
    expect(careReminder(asked, at("2028-01-16T08:00:00Z"))).toBe(
      "phrase_check",
    );
    expect(
      careReminder(
        { ...c, remindedAt: at("2028-01-16T08:00:00Z") },
        at("2028-03-01T08:00:00Z"),
      ),
    ).toBeNull();
  });

  it("send the yearly check-up rather than the phrase check when both are due, once", () => {
    const c = care({
      provenOn: proven,
      phraseCheckedAt: at("2026-03-01T10:00:00Z"),
      phraseChecks: 4,
    });
    expect(careReminder(c, at("2027-01-03T08:00:00Z"))).toBe("key_checkup");
    expect(
      careReminder(
        { ...c, remindedAt: at("2027-01-03T08:00:00Z") },
        at("2027-01-10T08:00:00Z"),
      ),
    ).toBeNull();
  });
});

describe("how far an owner can count on a validator", () => {
  const now = at("2028-01-01T00:00:00Z");
  const signed = (provenOn: string) => ({
    provenOn: at(provenOn),
    phraseCheckedAt: at("2026-03-01T10:00:00Z"),
    phraseChecks: 1,
  });

  it("is lost when the keys are not those of the sealing, or are gone", () => {
    expect(validatorKeyState("b", care(), now)).toBe("lost");
    expect(validatorKeyState("a", undefined, now)).toBe("lost");
  });

  it("is silent after 13 months without a sign, the day of making the keys counting as one", () => {
    expect(
      validatorKeyState("a", care(signed("2026-11-30T00:00:00Z")), now),
    ).toBe("silent");
    expect(validatorKeyState("a", care(), now)).toBe("silent");
    expect(
      validatorKeyState("a", care(signed("2026-12-10T00:00:00Z")), now),
    ).toBe("ok");
  });

  it("waits for the phrase to be proved kept", () => {
    expect(
      validatorKeyState(
        "a",
        care({ provenOn: at("2027-12-01T00:00:00Z") }),
        now,
      ),
    ).toBe("not_saved");
  });

  it("counts on a passkey that syncs instead of the phrase, not on one kept by a single phone", () => {
    const provenOn = at("2027-12-01T00:00:00Z");
    const backup = (synced: boolean) => ({
      credentialId: "x8fHx8fHx8fHx8fHx8fHx8fHx8c",
      synced,
      madeAt: at("2027-06-01T00:00:00Z"),
    });
    expect(
      validatorKeyState(
        "a",
        care({ provenOn, passkeyBackup: backup(true) }),
        now,
      ),
    ).toBe("ok");
    expect(
      validatorKeyState(
        "a",
        care({ provenOn, passkeyBackup: backup(false) }),
        now,
      ),
    ).toBe("not_saved");
    // A passkey says nothing of a phone silent for 13 months, or of keys that are not the sealing's.
    expect(
      validatorKeyState("a", care({ passkeyBackup: backup(true) }), now),
    ).toBe("silent");
    expect(
      validatorKeyState(
        "b",
        care({ provenOn, passkeyBackup: backup(true) }),
        now,
      ),
    ).toBe("lost");
  });
});

describe("with the keys in a passkey that syncs", () => {
  const backup = (synced: boolean, madeAt = "2026-03-02T10:00:00Z") => ({
    passkeyBackup: {
      credentialId: "x8fHx8fHx8fHx8fHx8fHx8fHx8c",
      synced,
      madeAt: at(madeAt),
    },
  });
  const checked = {
    phraseCheckedAt: at("2026-03-01T10:00:00Z"),
    phraseChecks: 1,
  };

  it("no check of the phrase falls due, nor is reminded: it is a fallback", () => {
    const c = care({ ...checked, ...backup(true) });
    const now = at("2026-03-08T10:00:00Z");
    expect(phraseCheckDueAt(c, now)).toBeNull();
    expect(phraseCheckDue(c, at("2027-01-01T00:00:00Z"))).toBe(false);
    expect(careReminder(c, now)).toBeNull();
    // The schedule itself goes on: a check made meanwhile is its next step.
    expect(phraseScheduleDueAt(c)?.toISOString()).toBe(
      "2026-03-08T10:00:00.000Z",
    );
  });

  it("checks of the phrase go on while the passkey stays on one phone", () => {
    const c = care({ ...checked, ...backup(false) });
    const now = at("2026-03-08T10:00:00Z");
    expect(phraseCheckDueAt(c, now)?.toISOString()).toBe(
      "2026-03-08T10:00:00.000Z",
    );
    expect(careReminder(c, now)).toBe("phrase_check");
  });

  it("are counted on for 13 months after the phone last confirmed the passkey, no longer", () => {
    const c = care({ ...checked, ...backup(true) });
    // 2026-03-02 + 396 days.
    expect(backedUpByPasskey(c, at("2027-04-02T10:00:00Z"))).toBe(true);
    expect(backedUpByPasskey(c, at("2027-04-03T10:00:01Z"))).toBe(false);
    expect(phraseCheckDue(c, at("2027-04-03T10:00:01Z"))).toBe(true);
    expect(
      validatorKeyState(
        "a",
        care({ provenOn: at("2027-12-01T00:00:00Z"), ...backup(true) }),
        at("2028-01-01T00:00:00Z"),
      ),
    ).toBe("not_saved");
  });

  it("the yearly check-up still asks a silent phone for a sign", () => {
    const c = care({ provenOn: at("2026-11-02T00:00:00Z"), ...backup(true) });
    expect(careReminder(c, at("2027-01-03T08:00:00Z"))).toBe("key_checkup");
  });
});
