/** A notification to create for one user, before it is stored. */
export interface NotificationDraft {
  userId: string;
  /** Kind, e.g. "trust_added": the app picks icon and wording from it. */
  type: string;
  title: string;
  body: string;
  /** `url`: the app screen to open on tap. */
  data: { url: string } & Record<string, unknown>;
  /**
   * Critical notifications (someone claims your contract) are pushed even when the user turned
   * push off, with high priority and as time-sensitive on iOS.
   */
  critical: boolean;
}

export interface Preferences {
  push_enabled: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { push_enabled: true };

/** Whether this notification goes to the user's phones as well as their inbox. */
export function shouldPush(
  draft: Pick<NotificationDraft, "critical">,
  preferences: Preferences,
): boolean {
  return draft.critical || preferences.push_enabled;
}
