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
    expect(fr).toContain("Réglages › Confidentialité");
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
      "vous ne pourrez l'ouvrir que si un jour Camille ne peut plus agir, avec l'accord de 2 de ses 3 validateurs.",
    );
    expect(fr).toContain(
      "Ces accès ne vous donneront aucun droit sur ses biens",
    );
    expect(fr).toContain("seulement pour ce que Camille vous aura demandé");
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
