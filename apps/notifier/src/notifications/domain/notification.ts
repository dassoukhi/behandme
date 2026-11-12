import { DEFAULT_TIME_ZONE, type EmailWriter } from "./email.js";
import type { Language } from "./language.js";

export type { Language };

export interface NotificationCopy {
  title: string;
  body: string;
}

/** A notification to create for one user, before it is stored. */
export interface NotificationDraft {
  userId: string;
  /** Kind, e.g. "trust_added": the app picks the icon from it. */
  type: string;
  /** The wording in every language; the recipient's preference picks one. */
  copy: Record<Language, NotificationCopy>;
  /** `url`: the app screen to open on tap. */
  data: { url: string } & Record<string, unknown>;
  /**
   * Critical notifications (someone claims your contract) are pushed even when the user turned
   * push off, with high priority and as time-sensitive on iOS.
   */
  critical: boolean;
  /** The e-mail's own text (who, until when); without it, the e-mail says the body. */
  email?: EmailWriter;
  /** The users the e-mail may name: their names are looked up before it is written. */
  mentions?: string[];
}

/** A draft in the language of its recipient: what is stored and pushed. */
export type RenderedNotification = Omit<NotificationDraft, "copy" | "email"> &
  NotificationCopy;

export function render(
  draft: NotificationDraft,
  language: Language,
): RenderedNotification {
  const { userId, type, data, critical } = draft;
  return { userId, type, data, critical, ...draft.copy[language] };
}

export interface Preferences {
  push_enabled: boolean;
  email_enabled: boolean;
  language: Language;
  /** IANA name, e.g. "Europe/Paris": the dates e-mails give are in it. */
  time_zone: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  push_enabled: true,
  email_enabled: true,
  language: "fr",
  time_zone: DEFAULT_TIME_ZONE,
};

/** Whether this notification goes to the user's phones as well as their inbox. */
export function shouldPush(
  draft: Pick<NotificationDraft, "critical">,
  preferences: Pick<Preferences, "push_enabled">,
): boolean {
  return draft.critical || preferences.push_enabled;
}
