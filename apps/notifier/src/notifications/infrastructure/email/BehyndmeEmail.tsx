import type { CSSProperties, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EMAIL_COPY,
  type EmailContent,
  type EmailFact,
} from "../../domain/email.js";
import { LOGO_SIZE } from "./logo.js";
import { COLORS, GMAIL_GREYS, SANS, SERIF } from "./theme.js";

// The BehyndMe e-mail, in the app's dark "Ardoise & Or" theme: the gold logo and name (one image) on the slate
// background, a card with the notification (greeting, its text, the key facts such as a deadline, and a
// box that says to open the app: never a link), and the reasons for the e-mail under a fine rule. Tables and inline styles,
// as e-mail clients ignore most modern CSS; React escapes every text it writes, so a name cannot inject
// markup. No hidden text (no preheader filler) and no unsubscribe wording: Gmail reads both as marketing
// and files the e-mail under Promotions, where a security alert must not end up.

/** Content-ID of the logo sent inline with each e-mail: the HTML shows it as `cid:logo`. */
export const LOGO_CONTENT_ID = "logo";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * @param logoSrc `cid:logo` in a sent e-mail (the logo travels with it, nothing is fetched); a data
 *   URL in a preview, as browsers do not read `cid:`.
 */
export function renderEmail(
  content: EmailContent,
  logoSrc = `cid:${LOGO_CONTENT_ID}`,
): RenderedEmail {
  const markup = renderToStaticMarkup(
    <BehyndmeEmail content={content} logoSrc={logoSrc} />,
  );
  return {
    subject: content.subject,
    html: `<!DOCTYPE html>${markup}`,
    text: plainText(content),
  };
}

function plainText(content: EmailContent): string {
  const copy = EMAIL_COPY[content.language];
  const colon = content.language === "fr" ? " : " : ": ";
  return [
    "BehyndMe",
    ...(content.critical ? [copy.securityAlert.toUpperCase()] : []),
    content.subject,
    copy.greeting(content.greetingName),
    ...content.paragraphs,
    ...(content.facts.length > 0
      ? [content.facts.map((f) => `${f.label}${colon}${f.value}`).join("\n")]
      : []),
    copy.openApp,
    `--\n${content.critical ? copy.why.critical : copy.why.regular}\n${copy.noLinks}`,
  ].join("\n\n");
}

// One theme, dark: the e-mail says so, so that Apple Mail does not repaint it. Narrow screens get less
// padding.
const CSS = `
:root { color-scheme: dark; supported-color-schemes: dark; }
body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
@media (max-width: 600px) {
  .bm-outer { padding: 16px 8px !important; }
  .bm-pad { padding-left: 24px !important; padding-right: 24px !important; }
}
`;

// Gmail's app, in dark mode, recolors every e-mail, dark ones included: each color keeps its hue and gets the
// opposite lightness. No setting of the sender's stops it. The counters, for Gmail only (`u + .body` matches
// the markup Gmail wraps the body in; other clients ignore it):
// - backgrounds, borders and rules are painted as one-color gradients, which Gmail leaves alone (fill(),
//   Frame, Rule); the logo is an image, which it leaves alone too;
// - every text sits inside two spans (Keep): Gmail turns their black background white, and the `difference`
//   with that white inverts the text back; the `screen` lays it on the dark background. Out of dark mode the
//   two blends leave the text as it is;
// - that inversion gives a grey back, not a color (the gold would turn lavender): in Gmail, each text is the
//   neutral grey as light as its color (GMAIL_GREYS).
const GMAIL_CSS = `
u + .body .gmail-screen { background: #000; mix-blend-mode: screen; }
u + .body .gmail-difference { background: #000; mix-blend-mode: difference; }
${Object.entries(GMAIL_GREYS)
  .map(
    ([grey, color]) =>
      `u + .body .gmail-${grey} { color: ${color} !important; }`,
  )
  .join("\n")}
`;

/** A background Gmail's dark mode does not recolor: the color, and the same color as a gradient. */
function fill(color: string): CSSProperties {
  return {
    backgroundColor: color,
    backgroundImage: `linear-gradient(${color}, ${color})`,
  };
}

/** The colors a text can have, and the grey it takes in Gmail. */
const TONES = {
  accent: { color: COLORS.accent, gmail: "ink" },
  ink: { color: COLORS.ink, gmail: "ink" },
  muted: { color: COLORS.muted, gmail: "muted" },
  subtle: { color: COLORS.subtle, gmail: "subtle" },
  danger: { color: COLORS.danger, gmail: "ink" },
} satisfies Record<string, { color: string; gmail: keyof typeof GMAIL_GREYS }>;

/** A text in its color, which Gmail's dark mode does not recolor. */
function Keep({
  tone,
  children,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
}) {
  const { color, gmail } = TONES[tone];
  return (
    <span className="gmail-screen">
      <span className={`gmail-difference gmail-${gmail}`} style={{ color }}>
        {children}
      </span>
    </span>
  );
}

const presentation = {
  role: "presentation",
  cellPadding: 0,
  cellSpacing: 0,
  border: 0,
} as const;

/**
 * A box with a 1 px border, the border drawn as a fill (a CSS border's color is recolored by Gmail): the
 * border's color shows through the 1 px padding around the box. As wide as its container, or as its content
 * with `fit`.
 */
function Frame({
  line,
  background,
  radius,
  padding,
  fit = false,
  className,
  style,
  children,
}: {
  line: string;
  background: string;
  radius: number;
  padding: string;
  fit?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const width = fit ? undefined : "100%";
  return (
    <table {...presentation} width={width} style={style}>
      <tbody>
        <tr>
          <td style={{ ...fill(line), borderRadius: radius, padding: 1 }}>
            <table {...presentation} width={width}>
              <tbody>
                <tr>
                  <td
                    className={className}
                    style={{
                      ...fill(background),
                      borderRadius: radius - 1,
                      padding,
                    }}
                  >
                    {children}
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** A 1 px hairline, drawn as a fill. */
function Rule() {
  return (
    <table {...presentation} width="100%">
      <tbody>
        <tr>
          <td
            height={1}
            style={{
              ...fill(COLORS.border),
              height: 1,
              fontSize: 1,
              lineHeight: "1px",
            }}
          >
            {" "}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function BehyndmeEmail({
  content,
  logoSrc,
}: {
  content: EmailContent;
  logoSrc: string;
}) {
  const copy = EMAIL_COPY[content.language];
  const text: CSSProperties = {
    fontFamily: SANS,
    fontSize: 16,
    lineHeight: "24px",
  };
  return (
    <html lang={content.language} dir="ltr">
      <head>
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <meta name="supported-color-schemes" content="dark" />
        <meta name="x-apple-disable-message-reformatting" />
        <title>{content.subject}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <style dangerouslySetInnerHTML={{ __html: GMAIL_CSS }} />
      </head>
      <body className="body" style={fill(COLORS.canvas)}>
        <table {...presentation} width="100%" style={fill(COLORS.canvas)}>
          <tbody>
            <tr>
              <td
                align="center"
                className="bm-outer"
                style={{ padding: "32px 16px" }}
              >
                <table {...presentation} width="100%" style={{ maxWidth: 560 }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "0 8px 20px" }}>
                        <Brand logoSrc={logoSrc} />
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <Frame
                          line={COLORS.border}
                          background={COLORS.surface}
                          radius={16}
                          padding="32px"
                          className="bm-pad"
                        >
                          {content.critical && (
                            <SecurityBadge label={copy.securityAlert} />
                          )}
                          <h1
                            style={{
                              margin: "0 0 20px",
                              fontFamily: SERIF,
                              fontWeight: 400,
                              fontSize: 26,
                              lineHeight: "32px",
                            }}
                          >
                            <Keep tone="accent">{content.subject}</Keep>
                          </h1>
                          <p style={{ ...text, margin: "0 0 16px" }}>
                            <Keep tone="ink">
                              {copy.greeting(content.greetingName)}
                            </Keep>
                          </p>
                          {content.paragraphs.map((paragraph, i) => (
                            <p key={i} style={{ ...text, margin: "0 0 16px" }}>
                              {/* The first paragraph says what happened; the others explain. */}
                              <Keep tone={i === 0 ? "ink" : "muted"}>
                                {paragraph}
                              </Keep>
                            </p>
                          ))}
                          {content.facts.length > 0 && (
                            <Facts facts={content.facts} />
                          )}
                          <Frame
                            line={COLORS.accentLine}
                            background={COLORS.canvas}
                            radius={12}
                            padding="14px 16px"
                            style={{ marginTop: 8 }}
                          >
                            <div
                              style={{
                                ...text,
                                fontSize: 15,
                                lineHeight: "22px",
                              }}
                            >
                              <Keep tone="ink">{copy.openApp}</Keep>
                            </div>
                          </Frame>
                        </Frame>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ paddingTop: 24 }}>
                        <Rule />
                        <table {...presentation} width="100%">
                          <tbody>
                            <tr>
                              <td
                                className="bm-pad"
                                style={{
                                  padding: "20px 8px 0",
                                  fontFamily: SANS,
                                  fontSize: 13,
                                  lineHeight: "20px",
                                }}
                              >
                                <p style={{ margin: "0 0 8px" }}>
                                  <Keep tone="subtle">
                                    {content.critical
                                      ? copy.why.critical
                                      : copy.why.regular}
                                  </Keep>
                                </p>
                                {/* A security message: readable (#94A3B8, 6.8:1), not the footer's grey. */}
                                <p style={{ margin: 0 }}>
                                  <Keep tone="muted">{copy.noLinks}</Keep>
                                </p>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

/**
 * The symbol and the name in gold, one image (Gmail's dark mode would recolor a gold text). With images off,
 * the alternative text says BehyndMe in the title's style.
 */
function Brand({ logoSrc }: { logoSrc: string }) {
  return (
    // fetchPriority "low" keeps React from adding a <link rel="preload"> for it to the head (an e-mail holds
    // no link).
    <img
      src={logoSrc}
      width={LOGO_SIZE.width}
      height={LOGO_SIZE.height}
      alt="BehyndMe"
      fetchPriority="low"
      style={{
        display: "block",
        border: 0,
        outline: "none",
        fontFamily: SERIF,
        fontSize: 24,
        lineHeight: "30px",
        color: COLORS.accent,
      }}
    />
  );
}

/** The key facts, one under the other (label, then value), between hairlines: it reads on a phone. */
function Facts({ facts }: { facts: EmailFact[] }) {
  return (
    <table {...presentation} width="100%" style={{ margin: "8px 0 16px" }}>
      <tbody>
        {facts.map((fact, i) => (
          <FactRow key={i} fact={fact} />
        ))}
        <tr>
          <td>
            <Rule />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function FactRow({ fact }: { fact: EmailFact }) {
  return (
    <>
      <tr>
        <td>
          <Rule />
        </td>
      </tr>
      <tr>
        <td style={{ padding: "10px 0" }}>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 12,
              lineHeight: "18px",
              fontWeight: 600,
              letterSpacing: "0.6px",
              textTransform: "uppercase",
            }}
          >
            <Keep tone="muted">{fact.label}</Keep>
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 16,
              lineHeight: "24px",
              fontWeight: 500,
            }}
          >
            <Keep tone="ink">{fact.value}</Keep>
          </div>
        </td>
      </tr>
    </>
  );
}

/**
 * The badge of a critical alert: the label in red on soft red, as the app's danger pill, with a red border that
 * Gmail keeps when it turns the label grey.
 */
function SecurityBadge({ label }: { label: string }) {
  return (
    <Frame
      line={COLORS.dangerLine}
      background={COLORS.dangerSoft}
      radius={999}
      padding="4px 12px"
      fit
      style={{ marginBottom: 16 }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 12,
          lineHeight: "18px",
          fontWeight: 600,
          letterSpacing: "0.6px",
          textTransform: "uppercase",
        }}
      >
        <Keep tone="danger">{label}</Keep>
      </div>
    </Frame>
  );
}
