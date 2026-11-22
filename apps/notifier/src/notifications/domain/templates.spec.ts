import { describe, expect, it } from "vitest";
import { emailContent, emailContext, type PersonName } from "./email.js";
import { render } from "./notification.js";
import * as templates from "./templates.js";
import { OCCURRED_AT, PEOPLE, SAMPLE } from "../testing/email-samples.js";

// What people read says « enveloppe » and « destinataire » (envelope, recipient): a « contrat » would sound like a
// legal commitment, which nobody makes here. The code keeps contract and accessor.
const OLD_WORDS = {
  fr: /\b(contrats?|accesseurs?)\b/i,
  en: /\b(contracts?|accessors?)\b/i,
} as const;

// Nor the words of a will or an inheritance: BehyndMe passes on access, not property, and is no will (art. 970 of the
// Code civil; misleading commercial practice, art. L121-2 of the Code de la consommation). The app's check-i18n.js
// refuses the same words.
const SUCCESSION_WORDS = {
  fr: /\b(testaments? numériques?|héritages? numériques?|légataires?|legs|dernières volontés|exécuteurs? testamentaires?)\b/i,
  en: /\b(digital wills?|digital legacy|legatees?|bequests?|last wishes)\b/i,
} as const;

// Every branch of the templates: each closing reason, both roles, with and without a quorum, the owner's own copy.
const REASONS = [
  "cancelled",
  "withdrawn",
  "rejected",
  "expired",
  "revoked",
  "participant_left",
  "account_deleted",
  "declined",
  "unknown",
];
const VARIANTS = [
  SAMPLE,
  { ...SAMPLE, role: "accessor" },
  { ...SAMPLE, quorum: false },
  { ...SAMPLE, trustedBack: false },
  { ...SAMPLE, userId: SAMPLE.ownerId },
  { ...SAMPLE, validatorCount: 1, threshold: 1 },
  { ...SAMPLE, validatorCount: 2, threshold: 2 },
  { ...SAMPLE, incapacityAllowed: false },
  { ...SAMPLE, claimReason: "death" },
  { ...SAMPLE, category: "finances" },
  { ...SAMPLE, last: false },
  ...REASONS.map((reason) => ({ ...SAMPLE, reason })),
];
// People whose names the e-mail knows, and people it does not (the sentences then say "the owner").
const CONTEXTS = [
  emailContext(PEOPLE, "Europe/Paris", OCCURRED_AT),
  emailContext(new Map<string, PersonName>(), "Europe/Paris", OCCURRED_AT),
];

describe.each(Object.entries(templates))("%s", (_name, template) => {
  it("says envelope and recipient, never contract or accessor, nor a will's words", () => {
    for (const params of VARIANTS) {
      const draft = template(params);
      for (const language of ["fr", "en"] as const) {
        const copy = render(draft, language);
        for (const context of CONTEXTS) {
          const email = emailContent(
            copy,
            draft.email,
            context,
            context.firstName(draft.userId),
            language,
          );
          const read = [
            copy.title,
            copy.body,
            email.subject,
            ...email.paragraphs,
            ...email.facts.flatMap((fact) => [fact.label, fact.value]),
          ];
          for (const text of read) {
            expect(text).not.toMatch(OLD_WORDS[language]);
            expect(text).not.toMatch(SUCCESSION_WORDS[language]);
          }
        }
      }
    }
  });
});

// Someone named in an envelope is told what their role is and is not, the rules it is part of, and where their rights
// are (art. 13 and 14 of the GDPR); the accessor also learns that the access gives no right to the owner's property and
// serves only what the owner asked (art. 323-1 of the Code pénal: going beyond it is a fraudulent stay).
describe("those named in an envelope", () => {
  const context = emailContext(PEOPLE, "Europe/Paris", OCCURRED_AT);
  const read = (
    draft: ReturnType<typeof templates.chosenAsValidator>,
    language: "fr" | "en",
  ) =>
    emailContent(
      render(draft, language),
      draft.email,
      context,
      context.firstName(draft.userId),
      language,
    ).paragraphs.join(" ");

  it("tell a validator what the role is and is not, its rules, and where their rights are", () => {
    const fr = read(templates.chosenAsValidator(SAMPLE), "fr");
    expect(fr).toContain("Vous ne verrez jamais ce que contient l'enveloppe.");
    expect(fr).toContain(
      "Ce rôle ne vous oblige à rien, ne vous donne aucun droit sur ses biens et ne remplace aucune démarche de succession.",
    );
    expect(fr).toContain(
      "Il faut 2 validations sur 3, et Camille dispose de 7 jours après la demande pour l'annuler.",
    );
    // When they may approve: the rules the owner chose (a death only, unless they consented to more).
    expect(fr).toContain(
      "vous ne l'approuverez qu'en cas de décès de Camille, ou si Camille ne peut plus agir, et si vous en êtes sûr.",
    );
    expect(
      read(
        templates.chosenAsValidator({ ...SAMPLE, incapacityAllowed: false }),
        "fr",
      ),
    ).toContain(
      "vous ne l'approuverez qu'en cas de décès de Camille, et si vous en êtes sûr.",
    );
    expect(fr).toContain("Réglages › Confidentialité");
    // The role is refused in the app (art. 21 of the GDPR): the owner is told and chooses someone else.
    expect(fr).toContain(
      "Si vous ne souhaitez pas le tenir, refusez-le dans l'app : ouvrez l'enveloppe et touchez « Refuser ce rôle ». Nous préviendrons Camille, qui pourra choisir quelqu'un d'autre.",
    );
    expect(read(templates.chosenAsValidator(SAMPLE), "en")).toContain(
      "decline it in the app: open the envelope and tap “Decline this role”.",
    );
    expect(
      read(
        templates.chosenAsValidator({
          ...SAMPLE,
          validatorCount: 1,
          threshold: 1,
        }),
        "en",
      ),
    ).toContain(
      "Your approval is enough, and Camille has 7 days after the request to cancel it.",
    );
  });

  it("tell the accessor it is for later, gives no right to property, and serves only what was asked", () => {
    const draft = templates.chosenAsAccessor(SAMPLE);
    expect(draft).toMatchObject({
      userId: "user_alex",
      type: "accessor_chosen",
      data: { url: "/contract/contract_1" },
      critical: false,
    });
    const fr = read(draft, "fr");
    expect(fr).toContain(
      "vous ne pourrez l'ouvrir qu'après le décès de Camille, ou si un jour Camille ne peut plus agir, avec l'accord de 2 de ses 3 validateurs.",
    );
    expect(
      read(
        templates.chosenAsAccessor({ ...SAMPLE, incapacityAllowed: false }),
        "fr",
      ),
    ).toContain(
      "vous ne pourrez l'ouvrir qu'après le décès de Camille, avec l'accord de 2 de ses 3 validateurs.",
    );
    expect(
      read(
        templates.chosenAsAccessor({ ...SAMPLE, incapacityAllowed: false }),
        "en",
      ),
    ).toContain("you can open it only after Camille's death, with");
    expect(fr).toContain(
      "Ces accès ne vous donneront aucun droit sur ses biens",
    );
    expect(fr).toContain("seulement pour ce que Camille vous aura demandé");
    expect(fr).toContain(
      "Si vous ne souhaitez pas ce rôle, refusez-le dans l'app : ouvrez l'enveloppe et touchez « Refuser ce rôle ».",
    );
    expect(
      read(
        templates.chosenAsAccessor({
          ...SAMPLE,
          validatorCount: 2,
          threshold: 2,
        }),
        "en",
      ),
    ).toContain("with the approval of both of their validators.");
  });
});

// The owner learns who refused their role, and what to do: choose someone else and seal again. A deleted account is
// not named (its name may already be forgotten).
describe("a participant who left", () => {
  const context = emailContext(PEOPLE, "Europe/Paris", OCCURRED_AT);
  const read = (draft: ReturnType<typeof templates.participantLeft>) => {
    const copy = render(draft, "fr");
    const email = emailContent(
      copy,
      draft.email,
      context,
      context.firstName(draft.userId),
      "fr",
    );
    return { push: copy.body, email: email.paragraphs.join(" ") };
  };

  it("names whoever declined, to the owner, and asks to seal again", () => {
    const draft = templates.participantLeft({
      ...SAMPLE,
      role: "validator",
      reason: "declined",
    });
    expect(draft).toMatchObject({
      userId: "user_camille",
      type: "participant_left",
      data: { url: "/contract/contract_1" },
    });
    const { push, email } = read(draft);
    expect(push).toBe(
      "Un validateur de votre enveloppe « Réseaux sociaux » a refusé son rôle : sa part ne servira pas. Scellez-la à nouveau pour en choisir un autre.",
    );
    expect(email).toContain(
      "Léa Petit a refusé d'être validateur de votre enveloppe « Réseaux sociaux » : sa part de la clé ne servira pas.",
    );
    expect(
      read(
        templates.participantLeft({
          ...SAMPLE,
          role: "accessor",
          reason: "declined",
        }),
      ).email,
    ).toContain(
      "Léa Petit a refusé d'être le destinataire de votre enveloppe « Réseaux sociaux » : cette personne ne la voit plus et ne pourra pas l'ouvrir. Pour que cette enveloppe puisse encore être transmise, choisissez un autre destinataire",
    );
  });

  it("does not name a deleted account", () => {
    const { push, email } = read(
      templates.participantLeft({
        ...SAMPLE,
        role: "accessor",
        reason: "account_deleted",
      }),
    );
    expect(push).toContain("a supprimé son compte");
    expect(email).not.toContain("Léa");
  });
});

// A claim says why: a death, or that the owner can no longer act (only where they consented to it). The e-mails say it;
// the lock screen does not.
describe("a claim and its reason", () => {
  const context = emailContext(PEOPLE, "Europe/Paris", OCCURRED_AT);
  const read = (draft: ReturnType<typeof templates.claimFiledForOwner>) => {
    const copy = render(draft, "fr");
    const email = emailContent(
      copy,
      draft.email,
      context,
      context.firstName(draft.userId),
      "fr",
    );
    return {
      push: `${copy.title} ${copy.body}`,
      email: email.paragraphs.join(" "),
      facts: email.facts,
    };
  };

  it("tells the owner the reason given, by e-mail only", () => {
    const owner = read(templates.claimFiledForOwner(SAMPLE));
    expect(owner.email).toContain("en indiquant que vous ne pouvez plus agir.");
    expect(owner.facts).toContainEqual({
      label: "Motif",
      value: "Ne peut plus agir",
    });
    expect(owner.push).not.toMatch(/agir|décès/);
    expect(
      read(templates.claimFiledForOwner({ ...SAMPLE, claimReason: "death" }))
        .email,
    ).toContain("en indiquant votre décès.");
  });

  it("points to the statement of a claim for an incapacity, never quoting it", () => {
    expect(read(templates.claimFiledForOwner(SAMPLE)).email).toContain(
      "Sa déclaration est dans l'app.",
    );
    expect(read(templates.claimFiledForValidator(SAMPLE)).email).toContain(
      "Lisez sa déclaration dans l'app avant de décider.",
    );
    expect(
      read(
        templates.claimFiledForValidator({ ...SAMPLE, claimReason: "death" }),
      ).email,
    ).not.toContain("déclaration");
  });

  it("tells a validator the reason given, and to approve only if sure of it", () => {
    const validator = read(templates.claimFiledForValidator(SAMPLE));
    expect(validator.email).toContain(
      "Léa Petit demande la transmission de l'enveloppe « Réseaux sociaux » de Camille Martin, en indiquant que Camille ne peut plus agir.",
    );
    expect(validator.email).toContain(
      "n'approuvez que si vous en êtes sûr ; sinon, refusez.",
    );
    expect(validator.push).not.toMatch(/agir|décès/);
    expect(
      read(
        templates.claimFiledForValidator({ ...SAMPLE, claimReason: "death" }),
      ).email,
    ).toContain("en indiquant le décès de Camille.");
  });
});

// A claim for an incapacity is reminded halfway too: that reminder is not the last.
describe("the owner's reminders", () => {
  it("call the one halfway a reminder, and the day before the last one", () => {
    const halfway = render(
      templates.claimReminderForOwner({ ...SAMPLE, last: false }),
      "fr",
    );
    expect(halfway.title).toBe("Rappel");
    expect(halfway.body).not.toContain("bientôt");
    expect(
      render(templates.claimReminderForOwner({ ...SAMPLE, last: true }), "fr")
        .title,
    ).toBe("Dernier rappel");
  });
});
