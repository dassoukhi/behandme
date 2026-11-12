import { z } from "zod";
import { serviceEnv } from "@lib/platform";

export const notifierEnv = serviceEnv.extend({
  PORT: z.coerce.number().int().default(3001),
  /** Optional: Expo's "enhanced security for push notifications" access token. */
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  /** Resend API key (sending access, limited to the domain). Without it, e-mail is off. */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** Sender of the e-mails; its domain must be verified at Resend. */
  EMAIL_FROM: z
    .string()
    .regex(
      /^[^<>@]+ <[^<>@\s]+@[^<>@\s]+>$/,
      "e.g. BehyndMe <alertes@behyndme.com>",
    )
    .default("BehyndMe <alertes@behyndme.com>"),
});
