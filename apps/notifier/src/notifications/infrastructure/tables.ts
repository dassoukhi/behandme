import type { ColumnType, Generated, JSONColumnType } from "kysely";
import type { PushMessage } from "../domain/push.js";

// Schema notify (supabase/migrations/20261014180000_notifier_and_worker.sql).

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
  updated_at: ColumnType<Date, Date | undefined, Date>;
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
}
