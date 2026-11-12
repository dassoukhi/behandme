import { describe, expect, it } from "vitest";
import {
  deliverableAddress,
  type EmailContext,
  emailContent,
  emailContext,
  formatMoment,
  safeName,
  shouldEmail,
} from "./email.js";
import { render } from "./notification.js";
import * as templates from "./templates.js";
import { keysTransferred, trustAdded } from "./templates.js";

describe("safeName", () => {
  it.each([
    ["Camille", "Camille"],
    ["Jean-Pierre O’Connor", "Jean-Pierre O’Connor"],
    ["J. Martin", "J. Martin"],
    ["  Léa \n Petit ", "Léa Petit"],
    ["Zoë d'Arc", "Zoë d'Arc"],
  ])("shows %j as %j", (name, shown) => {
    expect(safeName(name)).toBe(shown);
  });

  it.each([
    "Support BehyndMe: call +33 1 23 45 67 89",
    "go to behyndme-secure.com",
    "behyndme.com",
    "behyndme.\u0301com",
    "http://x",
    "a@b",
    "Agent 007",
    "x".repeat(41),
    "",
    "   ",
    "-dash first",
  ])("hides %j", (name) => {
    expect(safeName(name)).toBeNull();
  });
});

describe("mentions", () => {
  // Each template names, in its e-mail, only the users it lists: the others' names are not looked up.
  const ids = {
    userId: "u",
    ownerId: "o",
    validatorId: "v",
    accessorId: "a",
    trusterId: "t",
    claimantId: "c",
    contractId: "k",
    ownerName: null,
    userName: null,
    category: "devices",
    quorum: true,
    reason: "withdrawn",
    role: "validator",
    contestUntil: "2026-11-19T13:30:00.000Z",
    usableFrom: "2026-11-15T13:30:00.000Z",
  };

  it.each(Object.entries(templates))(
    "%s lists everyone its e-mail names",
    (_name, template) => {
      const draft = template(ids);
      const named = new Set<string>();
      const nobody = { fr: "", en: "" };
      const recorder: EmailContext = {
        name: (id) => (named.add(id), "N"),
        firstName: (id) => (named.add(id), "N"),
        at: () => nobody,
        occurred: nobody,
      };
      draft.email?.(recorder);
      expect([...named].sort()).toEqual([...(draft.mentions ?? [])].sort());
    },
  );
});

describe("shouldEmail", () => {
  it("respects the user's choice, except for critical notifications", () => {
    expect(shouldEmail({ critical: false }, { email_enabled: true })).toBe(
      true,
    );
    expect(shouldEmail({ critical: false }, { email_enabled: false })).toBe(
      false,
    );
    expect(shouldEmail({ critical: true }, { email_enabled: false })).toBe(
      true,
    );
  });
});

describe("deliverableAddress", () => {
  it.each([
    "nina@mail.fr",
    "sam@behyndme.com",
    "lea@test.fr",
    "a@examples.com",
  ])("accepts %s", (address) => {
    expect(deliverableAddress(address)).toBe(true);
  });

  it.each([
    "behindme-e2e-owner+clerk_test@example.com",
    "x@EXAMPLE.ORG",
    "x@mail.example",
    "x@host.test",
    "x@nowhere.invalid",
    "x@localhost",
    "no-at-sign",
    "@mail.fr",
    "nina@",
  ])("refuses %s", (address) => {
    expect(deliverableAddress(address)).toBe(false);
  });
});

describe("formatMoment", () => {
  const iso = "2026-11-19T13:30:00.000Z";

  it("writes the day, time and offset in the user's language and time zone", () => {
    expect(formatMoment(iso, "fr", "Europe/Paris")).toBe(
      "jeudi 19 novembre 2026 à 14:30 (UTC+1)",
    );
    expect(formatMoment(iso, "en", "America/New_York")).toBe(
      "Thursday 19 November 2026 at 08:30 (GMT-5)",
    );
  });

  it("writes the first of the month as French does", () => {
    expect(formatMoment("2026-12-01T09:00:00.000Z", "fr", "Europe/Paris")).toBe(
      "mardi 1er décembre 2026 à 10:00 (UTC+1)",
    );
  });

  it("falls back to Paris for a time zone Intl does not know", () => {
    expect(formatMoment(iso, "fr", "Mars/Olympus")).toBe(
      "jeudi 19 novembre 2026 à 14:30 (UTC+1)",
    );
  });
});

describe("emailContext", () => {
  const people = new Map([
    ["camille", { firstName: "Camille", lastName: "Martin" }],
    ["sam", { firstName: null, lastName: "Durand" }],
    ["tricky", { firstName: "Léa\nPetit", lastName: null }],
  ]);
  const context = emailContext(
    people,
    "Europe/Paris",
    "2026-11-12T13:30:00.000Z",
  );

  it("names people as BehyndMe knows them, on one line", () => {
    expect(context.name("camille")).toBe("Camille Martin");
    expect(context.firstName("camille")).toBe("Camille");
    expect(context.firstName("sam")).toBe("Durand");
    expect(context.name("tricky")).toBe("Léa Petit");
    expect(context.name("stranger")).toBeNull();
    expect(context.firstName("stranger")).toBeNull();
  });

  it("dates the event in both languages", () => {
    expect(context.occurred).toEqual({
      fr: "jeudi 12 novembre 2026 à 14:30 (UTC+1)",
      en: "Thursday 12 November 2026 at 14:30 (GMT+1)",
    });
  });
});

describe("emailContent", () => {
  const context = emailContext(
    new Map([["a", { firstName: "Alice", lastName: "Martin" }]]),
    "Europe/Paris",
    "2026-11-12T13:30:00.000Z",
  );

  it("takes the template's e-mail text, and greets the recipient by first name", () => {
    const draft = trustAdded({ userId: "b", ownerId: "a", ownerName: null });
    const content = emailContent(
      render(draft, "en"),
      draft.email,
      context,
      "Bob",
      "en",
    );
    expect(content).toMatchObject({
      language: "en",
      critical: false,
      subject: "Alice Martin added you as a trusted contact",
      greetingName: "Bob",
      facts: [],
    });
    expect(content.paragraphs[0]).toBe(
      "Alice Martin added you as a trusted contact on BehyndMe.",
    );
  });

  it("says the push body when a template has no e-mail text, its title on one line", () => {
    const content = emailContent(
      { critical: true, title: "Line\none", body: "The body." },
      undefined,
      context,
      null,
      "fr",
    );
    expect(content).toEqual({
      language: "fr",
      critical: true,
      subject: "Line one",
      greetingName: null,
      paragraphs: ["The body."],
      facts: [],
    });
  });

  it("dates a key alert with the event's time", () => {
    const draft = keysTransferred({ userId: "b" });
    const content = emailContent(
      render(draft, "fr"),
      draft.email,
      context,
      null,
      "fr",
    );
    expect(content.paragraphs[0]).toBe(
      "Vos clés BehyndMe ont été copiées sur un nouveau téléphone le jeudi 12 novembre 2026 à 14:30 (UTC+1).",
    );
  });
});
