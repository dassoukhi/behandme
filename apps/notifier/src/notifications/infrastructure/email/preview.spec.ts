import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emailContent, emailContext } from "../../domain/email.js";
import { type Language, render } from "../../domain/notification.js";
import * as templates from "../../domain/templates.js";
import { OCCURRED_AT, PEOPLE, SAMPLE } from "../../testing/email-samples.js";
import { renderEmail } from "./BehyndmeEmail.js";
import { LOGO_PNG_BASE64 } from "./logo.js";

// Writes every notification's e-mail, in both languages, as HTML files to look at in a browser:
//   npm run email:preview   (EMAIL_PREVIEW_DIR to choose the folder, $TMPDIR/behyndme-emails by default)
// Skipped by `npm test`. The logo is a data URL here, as browsers do not read `cid:`.

export interface PreviewEmail {
  name: string;
  language: Language;
  critical: boolean;
  subject: string;
  html: string;
}

/** Every template's e-mail, in each language, with the logo as a data URL. */
export function previewEmails(): PreviewEmail[] {
  const logo = `data:image/png;base64,${LOGO_PNG_BASE64}`;
  const context = emailContext(PEOPLE, "Europe/Paris", OCCURRED_AT);
  return Object.entries(templates).flatMap(([name, template]) =>
    (["fr", "en"] as const).map((language) => {
      const draft = template(SAMPLE);
      const notification = render(draft, language);
      const content = emailContent(
        notification,
        draft.email,
        context,
        context.firstName(draft.userId),
        language,
      );
      const email = renderEmail(content, logo);
      return {
        name,
        language,
        critical: notification.critical,
        subject: email.subject,
        html: email.html,
      };
    }),
  );
}

describe.skipIf(!process.env.EMAIL_PREVIEW)("e-mail preview", () => {
  it("writes every e-mail to a folder", () => {
    const dir =
      process.env.EMAIL_PREVIEW_DIR ?? join(tmpdir(), "behyndme-emails");
    mkdirSync(dir, { recursive: true });
    const emails = previewEmails();
    for (const email of emails) {
      writeFileSync(
        join(dir, `${email.name}.${email.language}.html`),
        email.html,
      );
    }
    const rows = emails
      .map(
        (e) =>
          `<li><a href="${e.name}.${e.language}.html">${e.name} (${e.language})</a>${e.critical ? " — critique" : ""}</li>`,
      )
      .join("\n");
    writeFileSync(
      join(dir, "index.html"),
      `<!DOCTYPE html><meta charset="utf-8"><title>E-mails BehyndMe</title><ul>${rows}</ul>`,
    );
    console.info(`${emails.length} e-mails in ${dir}`);
    expect(emails.length).toBe(Object.keys(templates).length * 2);
  });
});
