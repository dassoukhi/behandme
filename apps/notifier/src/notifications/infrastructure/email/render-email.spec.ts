import { describe, expect, it } from "vitest";
import {
  EMAIL_COPY,
  emailContent,
  emailContext,
  type EmailContent,
} from "../../domain/email.js";
import { render } from "../../domain/notification.js";
import * as templates from "../../domain/templates.js";
import { renderEmail } from "./BehyndmeEmail.js";
import { OCCURRED_AT, PEOPLE, SAMPLE } from "../../testing/email-samples.js";

// Every notification's e-mail, in both languages: what each one must and must not hold.
const context = emailContext(PEOPLE, "Europe/Paris", OCCURRED_AT);
const cases = Object.entries(templates).flatMap(([name, template]) =>
  (["fr", "en"] as const).map((language) => {
    const draft = template(SAMPLE);
    const content = emailContent(
      render(draft, language),
      draft.email,
      context,
      context.firstName(draft.userId),
      language,
    );
    return { name: `${name} (${language})`, content };
  }),
);

describe.each(cases)("$name", ({ content }) => {
  const email = renderEmail(content);

  it("hides no text and avoids unsubscribe wording, which Gmail files under Promotions", () => {
    expect(email.html).not.toMatch(/display:\s*none/i);
    expect(email.html).not.toMatch(/\u200c/);
    expect(`${email.html} ${email.text}`).not.toMatch(
      /ne plus recevoir|unsubscribe|se désabonner|stop these/i,
    );
  });

  it("holds no link and loads nothing: its one image is the logo sent with it", () => {
    expect(email.html).not.toMatch(/href=/i);
    expect(email.html).not.toMatch(/https?:\/\//i);
    expect(email.html).not.toMatch(/url\(/i);
    expect([...email.html.matchAll(/src="([^"]*)"/g)].map((m) => m[1])).toEqual(
      ["cid:logo"],
    );
  });

  it("says BehyndMe never sends a link nor asks for the phrase, in HTML and in text", () => {
    const copy = EMAIL_COPY[content.language];
    expect(email.html).toContain(escapeHtml(copy.noLinks));
    expect(email.text).toContain(copy.noLinks);
    expect(email.text).toContain(copy.openApp);
  });

  it("carries the security badge only on critical alerts", () => {
    const badge = EMAIL_COPY[content.language].securityAlert;
    expect(email.html.includes(`>${badge}<`)).toBe(content.critical);
  });

  it("writes the greeting and every paragraph in both versions", () => {
    const greeting = EMAIL_COPY[content.language].greeting(
      content.greetingName,
    );
    expect(email.text).toContain(greeting);
    for (const paragraph of content.paragraphs) {
      expect(email.text).toContain(paragraph);
      expect(email.html).toContain(escapeHtml(paragraph));
    }
    expect(email.subject).toBe(content.subject);
    expect(email.html).toContain(`<html lang="${content.language}"`);
  });
});

describe("renderEmail", () => {
  const base: EmailContent = {
    language: "fr",
    critical: false,
    subject: "Sujet",
    greetingName: null,
    paragraphs: ["Texte."],
    facts: [],
  };

  it("escapes what a person could write in their name", () => {
    const email = renderEmail({
      ...base,
      greetingName: '<img src=x onerror="alert(1)">',
      paragraphs: ["<script>alert(1)</script> vous a ajouté."],
      facts: [{ label: "Demandée par", value: "<b>Sam</b>" }],
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).not.toContain("<b>Sam</b>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("greets without a name when there is none", () => {
    expect(renderEmail(base).text).toContain("Bonjour,");
    expect(renderEmail({ ...base, greetingName: "Alex" }).text).toContain(
      "Bonjour Alex,",
    );
  });

  it("lists the facts in the text version, label then value", () => {
    const text = renderEmail({
      ...base,
      facts: [{ label: "Annulation possible jusqu'au", value: "jeudi" }],
    }).text;
    expect(text).toContain("Annulation possible jusqu'au : jeudi");
    expect(
      renderEmail({
        ...base,
        language: "en",
        facts: [{ label: "Can be cancelled until", value: "Thursday" }],
      }).text,
    ).toContain("Can be cancelled until: Thursday");
  });

  it("shows the logo from a data URL in a preview", () => {
    expect(renderEmail(base, "data:image/png;base64,AAAA").html).toContain(
      'src="data:image/png;base64,AAAA"',
    );
  });
});

/** As React writes text into HTML. */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}
