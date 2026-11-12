import type { Language } from "./language.js";

// The e-mail of a notification. It says more than the push (who, until when), as an e-mail is read
// at leisure, but under the same rule: no secret and no contract description, only its category, and
// nothing about a person that the app would not show the recipient. It never holds a link either: a real
// alert asks to open the app, so a link in a message that looks like ours is a sign of phishing.

/** What an e-mail can name, resolved for its recipient (their language and time zone). */
export interface EmailContext {
  /** "Camille Martin" as BehyndMe knows the person; null when unknown or without a name. */
  name(userId: string): string | null;
  /** The first name only, else the full name; null when unknown. */
  firstName(userId: string): string | null;
  /** A moment in the recipient's time zone: "mercredi 19 novembre 2026 à 14:30". */
  at(iso: string): Record<Language, string>;
  /** When the event happened, as `at` writes it. */
  occurred: Record<Language, string>;
}

/** A label / value row of the e-mail, e.g. the deadline to cancel. */
export interface EmailFact {
  label: string;
  value: string;
}

/** The e-mail's own text for one notification, in one language. */
export interface EmailText {
  /** Defaults to the notification's title. */
  subject?: string;
  paragraphs: string[];
  facts?: EmailFact[];
}

/** Writes the e-mail of a notification in every language, from what the context resolves. */
export type EmailWriter = (
  context: EmailContext,
) => Record<Language, EmailText>;

/** Everything the template needs to write one e-mail: stored with the delivery, rendered when sent. */
export interface EmailContent {
  language: Language;
  /** A critical notification carries a security alert badge and cannot be turned off. */
  critical: boolean;
  subject: string;
  /** The recipient's first name, for the greeting; null to greet without a name. */
  greetingName: string | null;
  paragraphs: string[];
  facts: EmailFact[];
}

export function emailContent(
  notification: { critical: boolean; title: string; body: string },
  writer: EmailWriter | undefined,
  context: EmailContext,
  greetingName: string | null,
  language: Language,
): EmailContent {
  const text = writer?.(context)[language] ?? {
    paragraphs: [notification.body],
  };
  return {
    language,
    critical: notification.critical,
    subject: oneLine(text.subject ?? notification.title),
    greetingName: safeName(greetingName),
    paragraphs: text.paragraphs,
    facts: text.facts ?? [],
  };
}

/** Whether this notification also goes to the user's e-mail address. */
export function shouldEmail(
  notification: { critical: boolean },
  preferences: { email_enabled: boolean },
): boolean {
  return notification.critical || preferences.email_enabled;
}

/**
 * Non-critical e-mails a person gets at most in a day. With the rule below, it keeps someone from
 * flooding another's mailbox (add them to your trusted contacts, remove them, add them again…) and from
 * using up the provider's daily quota, which critical alerts need.
 */
export const REGULAR_EMAILS_PER_DAY = 10;

/**
 * What makes two e-mails the same kind: their type and the screen they are about
 * ("trust_added /people/a").
 */
export function emailKind(type: string, url: string): string {
  return `${type} ${url}`;
}

/**
 * Types whose e-mail goes once a day for the same kind: someone else can repeat them at will (add you,
 * remove you, add you again), and the second says nothing new. Not claims: a new claim on the same
 * contract is news.
 */
export const ONCE_A_DAY_TYPES: ReadonlySet<string> = new Set(["trust_added"]);

/**
 * A name as an e-mail may show it: letters, spaces, hyphens, apostrophes and initials, 40 characters at
 * most. Anyone chooses their own name, and our domain signs the e-mail: a name holding digits, an @, a
 * domain or a link ("Support BehyndMe: call +33…") would make it a phishing message. Such a name is not
 * shown; the e-mail says "someone" instead.
 */
export function safeName(name: string | null | undefined): string | null {
  if (!name) return null;
  const clean = oneLine(name);
  if (clean.length === 0 || clean.length > 40) return null;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} '’.-]*$/u.test(clean)) return null;
  // A dot followed by a letter (or an accent over one) is a domain ("behyndme.com"), not an initial
  // ("J. Martin").
  if (/\.[\p{L}\p{M}]/u.test(clean)) return null;
  return clean;
}

/**
 * Domains that never receive mail (RFC 2606 and 6761), such as the test accounts' example.com: an e-mail
 * sent there would bounce and hurt the sending domain's reputation.
 */
const RESERVED =
  /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;

/** Whether an e-mail may be sent to `address`. */
export function deliverableAddress(address: string): boolean {
  const at = address.lastIndexOf("@");
  if (at < 1 || at === address.length - 1) return false;
  return !RESERVED.test(address.slice(at + 1));
}

/** A name or subject on one line: a name could hold a line break. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A person's name as the gateway shares it. */
export interface PersonName {
  firstName: string | null;
  lastName: string | null;
}

/** The context of one recipient's e-mails: the names it may use, their time zone, the event's time. */
export function emailContext(
  people: ReadonlyMap<string, PersonName>,
  timeZone: string,
  occurredAt: string,
): EmailContext {
  const first = (userId: string) => safeName(people.get(userId)?.firstName);
  const name = (userId: string) => {
    const person = people.get(userId);
    return (
      safeName(
        [person?.firstName, person?.lastName].filter(Boolean).join(" "),
      ) ?? first(userId)
    );
  };
  const at = (iso: string) => ({
    fr: formatMoment(iso, "fr", timeZone),
    en: formatMoment(iso, "en", timeZone),
  });
  return {
    name,
    firstName: (userId) => first(userId) ?? name(userId),
    at,
    occurred: at(occurredAt),
  };
}

/** The fixed text around the notification, in each language of the app. */
export interface EmailCopy {
  greeting(name: string | null): string;
  securityAlert: string;
  /** Replaces the button other e-mails would have. */
  openApp: string;
  /** Why the e-mail came, and how to stop it (non-critical) or why it cannot be (critical). */
  why: { critical: string; regular: string };
  noLinks: string;
}

export const EMAIL_COPY: Record<Language, EmailCopy> = {
  fr: {
    greeting: (name) => (name ? `Bonjour ${name},` : "Bonjour,"),
    securityAlert: "Alerte de sécurité",
    openApp:
      "Pour agir, ouvrez l'app BehyndMe sur votre téléphone : cet e-mail ne contient aucun lien.",
    why: {
      critical:
        "Les alertes de sécurité vous parviennent toujours, même si vous avez coupé les autres e-mails.",
      regular:
        "Pour ne plus recevoir ces e-mails : Réglages › Notifications, dans l'app. Les alertes de sécurité continueront de vous parvenir.",
    },
    noLinks:
      "BehyndMe ne vous enverra jamais de lien de connexion et ne vous demandera jamais votre phrase de récupération ni votre mot de passe.",
  },
  en: {
    greeting: (name) => (name ? `Hello ${name},` : "Hello,"),
    securityAlert: "Security alert",
    openApp:
      "To act on it, open the BehyndMe app on your phone: this email contains no link.",
    why: {
      critical:
        "Security alerts always reach you, even if you turned other emails off.",
      regular:
        "To stop these emails: Settings › Notifications, in the app. Security alerts will still reach you.",
    },
    noLinks:
      "BehyndMe will never send you a sign-in link, and will never ask for your recovery phrase or your password.",
  },
};

/** Where the time zone of a user is unknown (the app has not sent it yet). */
export const DEFAULT_TIME_ZONE = "Europe/Paris";

const LOCALE: Record<Language, string> = { fr: "fr-FR", en: "en-GB" };

/**
 * "jeudi 19 novembre 2026 à 14:30 (UTC+1)" or "Thursday 19 November 2026 at 08:30 (GMT-5)", in
 * `timeZone` (the default one when it is not a zone Intl knows). The offset says which time it is: a
 * deadline read abroad must not be misread.
 */
export function formatMoment(
  iso: string,
  language: Language,
  timeZone: string,
): string {
  const date = new Date(iso);
  const zone = knownTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat(LOCALE[language], {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
    timeZone: zone,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const time = `${part("hour")}:${part("minute")} (${part("timeZoneName")})`;
  if (language === "fr") {
    const day = part("day") === "1" ? "1er" : part("day");
    return `${part("weekday")} ${day} ${part("month")} ${part("year")} à ${time}`;
  }
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")} at ${time}`;
}

/** Whether Intl knows `timeZone` (an IANA name such as "Europe/Paris"). */
export function knownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}
