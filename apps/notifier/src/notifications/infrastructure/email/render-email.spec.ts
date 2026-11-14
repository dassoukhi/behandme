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
import { LOGO_SIZE } from "./logo.js";
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
    // The slate background, the card inside its border, the gold title.
    expect(html).toContain("background-color:#131A24");
    expect(html).toContain(
      `<td style="${fill("#2A3648")};border-radius:16px;padding:1px">`,
    );
    expect(html).toContain(
      `<td class="bm-pad" style="${fill("#1B2432")};border-radius:15px;padding:32px">`,
    );
    expect(html).toMatch(/<h1 style="[^"]*">[^]*?style="color:#E2C275">Sujet</);
    // None of the former light theme's colors is left.
    expect(html).not.toMatch(/#FFFFFF|#EEF1F5|#121A2A|#23406B|#D9B36A/i);
  });

  it("writes what happened in white and the explanations in grey", () => {
    const html = renderEmail({
      ...base,
      paragraphs: ["Fait.", "Explication."],
    }).html;
    expect(html).toContain(kept("ink", "#F8FAFC", "Fait."));
    expect(html).toContain(kept("muted", "#94A3B8", "Explication."));
  });

  it("shows the gold logo and name as one image, which says BehyndMe when images are off", () => {
    const html = renderEmail(base).html;
    expect(html).toContain(
      `<img src="cid:logo" width="${LOGO_SIZE.width}" height="${LOGO_SIZE.height}" alt="BehyndMe"`,
    );
    expect(html).not.toContain(">BehyndMe<");
  });

  it("keeps its dark design in Gmail's dark mode, which recolors every e-mail", () => {
    const email = renderEmail({
      ...base,
      critical: true,
      paragraphs: ["Fait.", "Explication."],
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
    // Every background, border and rule it paints is also a one-color gradient, which Gmail leaves alone:
    // the page, the card and its border, the badge and its border, the box and its gold border, the
    // hairlines. No CSS border is left for Gmail to recolor.
    for (const color of [
      "#131A24",
      "#1B2432",
      "#2A3648",
      "#342834",
      "#652F38",
      "#756B50",
    ]) {
      expect(html).toContain(fill(color));
    }
    expect(html).not.toMatch(/border(-top|-bottom)?:\s*\d+px/);
    // Every text sits in the two spans, in its color, with the grey Gmail shows instead: the subject, the
    // greeting, the badge, the paragraphs, the facts, the box and the footer.
    const copy = EMAIL_COPY.fr;
    for (const [grey, color, text] of [
      ["ink", "#E2C275", "Sujet"],
      ["ink", "#F8FAFC", "Bonjour,"],
      ["ink", "#FCA5A5", copy.securityAlert],
      ["ink", "#F8FAFC", "Fait."],
      ["muted", "#94A3B8", "Explication."],
      ["muted", "#94A3B8", "Contrat"],
      ["ink", "#F8FAFC", "Réseaux sociaux"],
      ["ink", "#F8FAFC", copy.openApp],
      ["subtle", "#64748B", copy.why.critical],
      ["muted", "#94A3B8", copy.noLinks],
    ] as const) {
      expect(html).toContain(kept(grey, color, escapeHtml(text)));
    }
    // A text colored anywhere else would be recolored (the logo's color only styles its alternative text).
    const colored = [...html.matchAll(/<(\w+)[^>]*style="(?:[^"]*;)?color:#/g)];
    expect(colored.map((m) => m[1]).sort()).toEqual(
      [...Array(10).fill("span"), "img"].sort(),
    );
  });

  it("gives every text, in Gmail, a neutral grey as light as its color", () => {
    const html = renderEmail({ ...base, critical: true }).html;
    const greys = Object.fromEntries(
      [
        ...html.matchAll(
          /u \+ \.body \.gmail-(\w+) \{ color: (#[0-9A-F]{6}) !important; \}/g,
        ),
      ].map((m) => [m[1], m[2]]),
    );
    expect(Object.keys(greys).sort()).toEqual(["ink", "muted", "subtle"]);
    for (const [grey, color] of Object.entries(greys)) {
      // Neutral: Gmail's counter turns any hue into its opposite, but leaves a grey a grey.
      expect(
        new Set([color.slice(1, 3), color.slice(3, 5), color.slice(5)]).size,
      ).toBe(1);
      // As light as the color it stands for (CIELAB lightness, within 1).
      const stands = { ink: "#F8FAFC", muted: "#94A3B8", subtle: "#64748B" }[
        grey
      ]!;
      expect(Math.abs(lightness(color) - lightness(stands))).toBeLessThan(1);
    }
    // Every text's grey has its rule.
    for (const m of html.matchAll(/class="gmail-difference gmail-(\w+)"/g)) {
      expect(greys[m[1]]).toBeDefined();
    }
  });

  it("shows the logo from a data URL in a preview", () => {
    expect(renderEmail(base, "data:image/png;base64,AAAA").html).toContain(
      'src="data:image/png;base64,AAAA"',
    );
  });
});

/** A background as the e-mail paints it: the color, and the same color as a gradient Gmail leaves alone. */
function fill(color: string): string {
  return `background-color:${color};background-image:linear-gradient(${color}, ${color})`;
}

/** A text in the two spans that undo Gmail's dark mode, in its color and with its Gmail grey. */
function kept(grey: string, color: string, text: string): string {
  return `<span class="gmail-screen"><span class="gmail-difference gmail-${grey}" style="color:${color}">${text}</span></span>`;
}

/** CIELAB lightness (L*) of a #RRGGBB color. */
function lightness(hex: string): number {
  const linear = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const y = 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

/** As React writes text into HTML. */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}
