import { Inject, Injectable } from "@nestjs/common";
import {
  Expo,
  type ExpoPushMessage,
  type ExpoPushReceipt,
  type ExpoPushTicket,
} from "expo-server-sdk";
import type { PushMessage, PushOutcome } from "../domain/push.js";
import type { PushGateway } from "../application/ports.js";

export const EXPO_ACCESS_TOKEN = Symbol("ExpoAccessToken");

/** Expo's push service (it forwards to APNs and FCM), in chunks of the size Expo accepts. */
@Injectable()
export class ExpoPushGateway implements PushGateway {
  private readonly expo: Expo;

  constructor(@Inject(EXPO_ACCESS_TOKEN) accessToken: string | undefined) {
    this.expo = new Expo({ accessToken });
  }

  async send(
    messages: (PushMessage & { to: string })[],
  ): Promise<PushOutcome[]> {
    const outcomes: PushOutcome[] = [];
    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      outcomes.push(...(await this.sendChunk(chunk)));
    }
    return outcomes;
  }

  /**
   * Expo refuses a request whose tokens belong to several Expo projects (a phone still registered
   * under an older project id): the error lists the tokens of each project, so each group is sent
   * on its own and the outcomes go back in the order of the messages.
   */
  private async sendChunk(chunk: ExpoPushMessage[]): Promise<PushOutcome[]> {
    try {
      return (await this.expo.sendPushNotificationsAsync(chunk)).map(toOutcome);
    } catch (error) {
      const groups = projectGroups(error);
      if (!groups) throw error;
      const outcomes = new Array<PushOutcome | undefined>(chunk.length);
      for (const tokens of groups) {
        const wanted = new Set(tokens);
        const indexes = chunk.flatMap((m, i) =>
          wanted.has(m.to as string) ? [i] : [],
        );
        if (indexes.length === 0) continue;
        const tickets = await this.expo.sendPushNotificationsAsync(
          indexes.map((i) => chunk[i]),
        );
        indexes.forEach((i, k) => (outcomes[i] = toOutcome(tickets[k])));
      }
      // A token Expo did not place in any project: never sent.
      return outcomes.map(
        (o) => o ?? { status: "error", message: "Token in no Expo project" },
      );
    }
  }

  async receipts(ticketIds: string[]): Promise<Map<string, PushOutcome>> {
    const receipts = new Map<string, PushOutcome>();
    for (const chunk of this.expo.chunkPushNotificationReceiptIds(ticketIds)) {
      const answer = await this.expo.getPushNotificationReceiptsAsync(chunk);
      for (const [id, receipt] of Object.entries(answer)) {
        receipts.set(id, toOutcome(receipt));
      }
    }
    return receipts;
  }
}

/** The token groups of Expo's "several projects in one request" error, or null for any other error. */
function projectGroups(error: unknown): string[][] | null {
  const e = error as { code?: unknown; details?: unknown } | null;
  if (e?.code !== "PUSH_TOO_MANY_EXPERIENCE_IDS") return null;
  if (!e.details || typeof e.details !== "object") return null;
  const groups = Object.values(e.details).filter(
    (v): v is string[] =>
      Array.isArray(v) && v.every((t) => typeof t === "string"),
  );
  return groups.length > 0 ? groups : null;
}

function toOutcome(answer: ExpoPushTicket | ExpoPushReceipt): PushOutcome {
  if (answer.status === "ok") {
    return { status: "ok", ...("id" in answer && { id: answer.id }) };
  }
  return {
    status: "error",
    message: answer.message,
    error: answer.details?.error,
  };
}
