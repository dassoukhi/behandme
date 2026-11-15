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
  ...REASONS.map((reason) => ({ ...SAMPLE, reason })),
];
// People whose names the e-mail knows, and people it does not (the sentences then say "the owner").
const CONTEXTS = [
  emailContext(PEOPLE, "Europe/Paris", OCCURRED_AT),
  emailContext(new Map<string, PersonName>(), "Europe/Paris", OCCURRED_AT),
];

describe.each(Object.entries(templates))("%s", (_name, template) => {
  it("says envelope and recipient, never contract or accessor", () => {
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
          for (const text of read)
            expect(text).not.toMatch(OLD_WORDS[language]);
        }
      }
    }
  });
});
