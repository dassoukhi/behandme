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

  it("is dark only, in the app's Ardoise & Or colors", () => {
    const html = renderEmail({ ...base, critical: true }).html;
    expect(html).toContain('<meta name="color-scheme" content="dark"/>');
    expect(html).not.toMatch(/prefers-color-scheme|light dark/);
    // The slate background, the card and its border, the gold title.
    expect(html).toContain("background-color:#131A24");
    expect(html).toMatch(
      /background-color:#1B2432;background-image:linear-gradient\(#1B2432, #1B2432\);border:1px solid #2A3648;border-radius:16px/,
    );
    expect(html).toMatch(/<h1 style="[^"]*color:#E2C275/);
    // None of the former light theme's colors is left.
    expect(html).not.toMatch(/#FFFFFF|#EEF1F5|#121A2A|#23406B|#D9B36A/i);
  });

  it("writes what happened in white and the explanations in grey", () => {
    const html = renderEmail({
      ...base,
      paragraphs: ["Fait.", "Explication."],
    }).html;
    const kept = (text: string) =>
      `<span class="gmail-screen"><span class="gmail-difference">${text}</span></span>`;
    expect(html).toContain(`color:#F8FAFC">${kept("Fait.")}`);
    expect(html).toContain(`color:#94A3B8">${kept("Explication.")}`);
  });

  it("keeps its dark design in Gmail's dark mode, which inverts every e-mail", () => {
    const email = renderEmail({
      ...base,
      critical: true,
      facts: [{ label: "Contrat", value: "Réseaux sociaux" }],
    });
    const html = email.html;
    // The blends, for Gmail only: `u + .body` matches the markup Gmail wraps the body in.
    expect(html).toContain('<body class="body"');
    expect(html).toContain(
      "u + .body .gmail-screen { background: #000; mix-blend-mode: screen; }",
    );
    expect(html).toContain(
      "u + .body .gmail-difference { background: #000; mix-blend-mode: difference; }",
    );
    // Every background it paints is also a one-color gradient, which Gmail leaves alone.
    for (const color of ["#131A24", "#1B2432", "#342834"]) {
      expect(html).toContain(
        `background-color:${color};background-image:linear-gradient(${color}, ${color})`,
      );
    }
    // Every text sits in the two spans: the name, the subject, the greeting, the badge, the facts, the box
    // and the footer.
    const copy = EMAIL_COPY.fr;
    for (const text of [
      "BehyndMe",
      "Sujet",
      "Bonjour,",
      copy.securityAlert,
      "Contrat",
      "Réseaux sociaux",
      copy.openApp,
      copy.why.critical,
      copy.noLinks,
    ]) {
      expect(html).toContain(
        `<span class="gmail-difference">${escapeHtml(text)}</span>`,
      );
    }
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
