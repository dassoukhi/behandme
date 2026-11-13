import type { CSSProperties, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EMAIL_COPY,
  type EmailContent,
  type EmailFact,
} from "../../domain/email.js";
import { COLORS, SANS, SERIF } from "./theme.js";

// The BehyndMe e-mail, in the app's dark "Ardoise & Or" theme: the gold logo and name on the slate
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

// Gmail's app inverts the colors of every e-mail in dark mode, dark ones included, and no setting of the
// sender's stops it. Two known counters, for Gmail only (`u + .body` matches the markup Gmail wraps the
// body in; other clients ignore it):
// - backgrounds painted as one-color gradients, which Gmail leaves alone (fill());
// - every text inside two spans (Keep): Gmail turns their black background white and inverts the text;
//   the `difference` with that white undoes the inversion, the `screen` lays the text back on the dark
//   background. Out of dark mode the two blends leave the text as it is.
const GMAIL_CSS = `
u + .body .gmail-screen { background: #000; mix-blend-mode: screen; }
u + .body .gmail-difference { background: #000; mix-blend-mode: difference; }
`;

/** A background Gmail's dark mode does not invert: the color, and the same color as a gradient. */
function fill(color: string): CSSProperties {
  return {
    backgroundColor: color,
    backgroundImage: `linear-gradient(${color}, ${color})`,
  };
}

/** A text whose color Gmail's dark mode does not invert. */
function Keep({ children }: { children: ReactNode }) {
  return (
    <span className="gmail-screen">
      <span className="gmail-difference">{children}</span>
    </span>
  );
}

const presentation = {
  role: "presentation",
  cellPadding: 0,
  cellSpacing: 0,
  border: 0,
} as const;

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
                      <td
                        className="bm-pad"
                        style={{
                          ...fill(COLORS.surface),
                          border: `1px solid ${COLORS.border}`,
                          borderRadius: 16,
                          padding: "32px",
                        }}
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
                            color: COLORS.accent,
                          }}
                        >
                          <Keep>{content.subject}</Keep>
                        </h1>
                        <p
                          style={{
                            ...text,
                            margin: "0 0 16px",
                            color: COLORS.ink,
                          }}
                        >
                          <Keep>{copy.greeting(content.greetingName)}</Keep>
                        </p>
                        {content.paragraphs.map((paragraph, i) => (
                          <p
                            key={i}
                            style={{
                              ...text,
                              margin: "0 0 16px",
                              // The first paragraph says what happened; the others explain.
                              color: i === 0 ? COLORS.ink : COLORS.muted,
                            }}
                          >
                            <Keep>{paragraph}</Keep>
                          </p>
                        ))}
                        {content.facts.length > 0 && (
                          <Facts facts={content.facts} />
                        )}
                        <table
                          {...presentation}
                          width="100%"
                          style={{ marginTop: 8 }}
                        >
                          <tbody>
                            <tr>
                              <td
                                style={{
                                  ...text,
                                  ...fill(COLORS.canvas),
                                  border: `1px solid ${COLORS.accentLine}`,
                                  borderRadius: 12,
                                  padding: "14px 16px",
                                  fontSize: 15,
                                  lineHeight: "22px",
                                  color: COLORS.ink,
                                }}
                              >
                                <Keep>{copy.openApp}</Keep>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ paddingTop: 24 }}>
                        <table {...presentation} width="100%">
                          <tbody>
                            <tr>
                              <td
                                className="bm-pad"
                                style={{
                                  borderTop: `1px solid ${COLORS.border}`,
                                  padding: "20px 8px 0",
                                  fontFamily: SANS,
                                  fontSize: 13,
                                  lineHeight: "20px",
                                }}
                              >
                                <p
                                  style={{
                                    margin: "0 0 8px",
                                    color: COLORS.subtle,
                                  }}
                                >
                                  <Keep>
                                    {content.critical
                                      ? copy.why.critical
                                      : copy.why.regular}
                                  </Keep>
                                </p>
                                {/* A security message: readable (#94A3B8, 6.8:1), not the footer's grey. */}
                                <p style={{ margin: 0, color: COLORS.muted }}>
                                  <Keep>{copy.noLinks}</Keep>
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

function Brand({ logoSrc }: { logoSrc: string }) {
  return (
    <table {...presentation}>
      <tbody>
        <tr>
          <td style={{ verticalAlign: "middle", paddingRight: 12 }}>
            {/*
              Decorative: the name next to it says BehyndMe. fetchPriority "low" keeps React from adding a
              <link rel="preload"> for it to the head (an e-mail holds no link).
            */}
            <img
              src={logoSrc}
              width={44}
              height={44}
              alt=""
              fetchPriority="low"
              style={{ display: "block", border: 0, outline: "none" }}
            />
          </td>
          <td
            style={{
              verticalAlign: "middle",
              fontFamily: SERIF,
              fontSize: 24,
              lineHeight: "30px",
              letterSpacing: "0.5px",
              color: COLORS.accent,
            }}
          >
            <Keep>BehyndMe</Keep>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** The key facts, one under the other (label, then value), between hairlines: it reads on a phone. */
function Facts({ facts }: { facts: EmailFact[] }) {
  return (
    <table {...presentation} width="100%" style={{ margin: "8px 0 16px" }}>
      <tbody>
        {facts.map((fact, i) => (
          <tr key={i}>
            <td
              style={{
                borderTop: `1px solid ${COLORS.border}`,
                borderBottom:
                  i === facts.length - 1 ? `1px solid ${COLORS.border}` : 0,
                padding: "10px 0",
              }}
            >
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 12,
                  lineHeight: "18px",
                  fontWeight: 600,
                  letterSpacing: "0.6px",
                  textTransform: "uppercase",
                  color: COLORS.muted,
                }}
              >
                <Keep>{fact.label}</Keep>
              </div>
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 16,
                  lineHeight: "24px",
                  fontWeight: 500,
                  color: COLORS.ink,
                }}
              >
                <Keep>{fact.value}</Keep>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SecurityBadge({ label }: { label: string }) {
  return (
    <table {...presentation} style={{ marginBottom: 16 }}>
      <tbody>
        <tr>
          <td
            style={{
              ...fill(COLORS.dangerSoft),
              color: COLORS.danger,
              borderRadius: 999,
              padding: "4px 12px",
              fontFamily: SANS,
              fontSize: 12,
              lineHeight: "18px",
              fontWeight: 600,
              letterSpacing: "0.6px",
              textTransform: "uppercase",
            }}
          >
            <Keep>{label}</Keep>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
