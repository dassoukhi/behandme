import { Inject, Injectable } from "@nestjs/common";
import {
  Expo,
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
      const tickets = await this.expo.sendPushNotificationsAsync(chunk);
      outcomes.push(...tickets.map(toOutcome));
    }
    return outcomes;
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
