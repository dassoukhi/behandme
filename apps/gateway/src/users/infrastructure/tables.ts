import type { ColumnType, Generated } from "kysely";

// public.users and public.trusted (supabase/migrations), as the pg driver returns them.

type Timestamp = ColumnType<Date, string | undefined, string>;

export interface UsersTable {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  phone_number: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TrustedTable {
  id: Generated<string>;
  owner_id: string;
  trusted_id: string;
  created_at: ColumnType<Date | null, string | undefined, never>;
}

export interface UsersDatabase {
  users: UsersTable;
  trusted: TrustedTable;
}
