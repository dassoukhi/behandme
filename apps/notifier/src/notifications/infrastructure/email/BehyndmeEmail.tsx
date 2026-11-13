import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EMAIL_COPY,
  type EmailContent,
  type EmailFact,
} from "../../domain/email.js";
import { BAND, DARK, LIGHT, SANS, SERIF } from "./theme.js";

// The BehyndMe e-mail: a midnight band with the logo, a card with the notification (greeting, its text,
// the key facts such as a deadline), and the reasons for the e-mail under it. Tables and inline styles,
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

// Dark mode, for the clients that honour it (Apple Mail): classes override the inline light colors.
const CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
@media (max-width: 600px) {
  .bm-outer { padding: 16px 8px !important; }
  .bm-pad { padding-left: 24px !important; padding-right: 24px !important; }
}
@media (prefers-color-scheme: dark) {
  .bm-canvas { background-color: ${DARK.canvas} !important; }
  .bm-band { border-color: ${DARK.border} !important; }
  .bm-card { background-color: ${DARK.surface} !important; border-color: ${DARK.border} !important; }
  .bm-ink { color: ${DARK.ink} !important; }
  .bm-muted { color: ${DARK.muted} !important; }
  .bm-rule { border-color: ${DARK.border} !important; }
  .bm-callout { background-color: ${DARK.sunken} !important; border-color: ${DARK.accent} !important; color: ${DARK.ink} !important; }
  .bm-badge { background-color: ${DARK.dangerSoft} !important; color: ${DARK.danger} !important; }
}
`;

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
    color: LIGHT.ink,
    fontSize: 16,
    lineHeight: "24px",
  };
  return (
    <html lang={content.language} dir="ltr">
      <head>
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <meta name="x-apple-disable-message-reformatting" />
        <title>{content.subject}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body className="bm-canvas" style={{ backgroundColor: LIGHT.canvas }}>
        <table
          {...presentation}
          width="100%"
          className="bm-canvas"
          style={{ backgroundColor: LIGHT.canvas }}
        >
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
                      <td
                        className="bm-band bm-pad"
                        style={{
                          backgroundColor: BAND.background,
                          border: `1px solid ${BAND.background}`,
                          borderBottom: 0,
                          borderRadius: "16px 16px 0 0",
                          padding: "22px 32px",
                        }}
                      >
                        <Brand logoSrc={logoSrc} />
                      </td>
                    </tr>
                    <tr>
                      <td
                        className="bm-card bm-pad"
                        style={{
                          backgroundColor: LIGHT.surface,
                          border: `1px solid ${LIGHT.border}`,
                          borderTop: 0,
                          borderRadius: "0 0 16px 16px",
                          padding: "32px",
                        }}
                      >
                        {content.critical && (
                          <SecurityBadge label={copy.securityAlert} />
                        )}
                        <h1
                          className="bm-ink"
                          style={{
                            margin: "0 0 20px",
                            fontFamily: SERIF,
                            fontWeight: 500,
                            fontSize: 28,
                            lineHeight: "34px",
                            color: LIGHT.ink,
                          }}
                        >
                          {content.subject}
                        </h1>
                        <p
                          className="bm-ink"
                          style={{ ...text, margin: "0 0 16px" }}
                        >
                          {copy.greeting(content.greetingName)}
                        </p>
                        {content.paragraphs.map((paragraph, i) => (
                          <p
                            key={i}
                            className="bm-ink"
                            style={{ ...text, margin: "0 0 16px" }}
                          >
                            {paragraph}
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
                                className="bm-callout"
                                style={{
                                  ...text,
                                  backgroundColor: LIGHT.canvas,
                                  borderLeft: `3px solid ${LIGHT.accent}`,
                                  borderRadius: 8,
                                  padding: "14px 16px",
                                  fontSize: 15,
                                  lineHeight: "22px",
                                }}
                              >
                                {copy.openApp}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td
                        className="bm-muted bm-pad"
                        style={{
                          padding: "24px 32px 0",
                          fontFamily: SANS,
                          fontSize: 13,
                          lineHeight: "20px",
                          color: LIGHT.muted,
                        }}
                      >
                        <p style={{ margin: "0 0 8px" }}>
                          {content.critical
                            ? copy.why.critical
                            : copy.why.regular}
                        </p>
                        <p style={{ margin: 0 }}>{copy.noLinks}</p>
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
              width={48}
              height={48}
              alt=""
              fetchPriority="low"
              style={{ display: "block", border: 0, outline: "none" }}
            />
          </td>
          <td
            style={{
              verticalAlign: "middle",
              fontFamily: SERIF,
              fontSize: 26,
              lineHeight: "32px",
              letterSpacing: "0.5px",
              color: BAND.brass,
            }}
          >
            BehyndMe
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
              className="bm-rule"
              style={{
                borderTop: `1px solid ${LIGHT.border}`,
                borderBottom:
                  i === facts.length - 1 ? `1px solid ${LIGHT.border}` : 0,
                padding: "10px 0",
              }}
            >
              <div
                className="bm-muted"
                style={{
                  fontFamily: SANS,
                  fontSize: 12,
                  lineHeight: "18px",
                  fontWeight: 600,
                  letterSpacing: "0.6px",
                  textTransform: "uppercase",
                  color: LIGHT.muted,
                }}
              >
                {fact.label}
              </div>
              <div
                className="bm-ink"
                style={{
                  fontFamily: SANS,
                  fontSize: 16,
                  lineHeight: "24px",
                  fontWeight: 500,
                  color: LIGHT.ink,
                }}
              >
                {fact.value}
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
            className="bm-badge"
            style={{
              backgroundColor: LIGHT.dangerSoft,
              color: LIGHT.danger,
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
            {label}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
