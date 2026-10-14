import { z } from "zod";
import { serviceEnv } from "@lib/platform";

export const notifierEnv = serviceEnv.extend({
  PORT: z.coerce.number().int().default(3001),
  /** Optional: Expo's "enhanced security for push notifications" access token. */
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
});
