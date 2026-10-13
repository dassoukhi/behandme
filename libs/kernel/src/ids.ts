import { randomUUID } from "node:crypto";

/** A new random identifier (UUID v4). */
export function newId(): string {
  return randomUUID();
}
