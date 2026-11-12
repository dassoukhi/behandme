import type { ColumnType, Generated, JSONColumnType } from "kysely";
import type { EmailContent } from "../domain/email.js";
import type { Language } from "../domain/notification.js";
import type { PushMessage } from "../domain/push.js";

// Schema notify (supabase/migrations/20261014180000_notifier_and_worker.sql, then
// 20261112120000_notify_email.sql for people, e-mails and the e-mail settings).

type CreatedAt = ColumnType<Date, Date | undefined, never>;

export interface NotificationsTable {
  id: Generated<string>;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: JSONColumnType<Record<string, unknown>>;
  read_at: Date | null;
  created_at: CreatedAt;
}

export interface PushTokensTable {
  token: string;
  user_id: string;
  created_at: CreatedAt;
}

export interface PreferencesTable {
  user_id: string;
  push_enabled: boolean;
  email_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  language: Language;
  time_zone: ColumnType<string, string | undefined, string>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface PeopleTable {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  occurred_at: ColumnType<Date, Date | undefined, Date>;
  deleted: ColumnType<boolean, boolean | undefined, boolean>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

type EmailStatus = "pending" | "sending" | "sent" | "failed";

export interface EmailDeliveriesTable {
  notification_id: string;
  to_address: string;
  content: JSONColumnType<EmailContent>;
  status: ColumnType<EmailStatus, "pending" | undefined, EmailStatus>;
  attempts: Generated<number>;
  next_attempt_at: ColumnType<Date, Date | undefined, Date>;
  provider_id: string | null;
  error: string | null;
  created_at: CreatedAt;
  finished_at: Date | null;
}

export interface DeliveriesTable {
  id: Generated<string>;
  notification_id: string;
  token: string;
  message: JSONColumnType<PushMessage>;
  status: ColumnType<
    "pending" | "sent" | "delivered" | "failed",
    "pending" | undefined,
    "pending" | "sent" | "delivered" | "failed"
  >;
  attempts: Generated<number>;
  next_attempt_at: ColumnType<Date, Date | undefined, Date>;
  ticket_id: string | null;
  error: string | null;
  created_at: CreatedAt;
  sent_at: Date | null;
  checked_at: Date | null;
}

export interface NotifyDatabase {
  notifications: NotificationsTable;
  push_tokens: PushTokensTable;
  preferences: PreferencesTable;
  deliveries: DeliveriesTable;
  people: PeopleTable;
  email_deliveries: EmailDeliveriesTable;
}
