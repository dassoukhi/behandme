/** The languages of the app, and so of its notifications. */
export type Language = "fr" | "en";

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
}

/** A draft in the language of its recipient: what is stored and pushed. */
export type RenderedNotification = Omit<NotificationDraft, "copy"> &
  NotificationCopy;

export function render(
  { copy, ...draft }: NotificationDraft,
  language: Language,
): RenderedNotification {
  return { ...draft, ...copy[language] };
}

export interface Preferences {
  push_enabled: boolean;
  language: Language;
}

export const DEFAULT_PREFERENCES: Preferences = {
  push_enabled: true,
  language: "fr",
};

/** Whether this notification goes to the user's phones as well as their inbox. */
export function shouldPush(
  draft: Pick<NotificationDraft, "critical">,
  preferences: Pick<Preferences, "push_enabled">,
): boolean {
  return draft.critical || preferences.push_enabled;
}
