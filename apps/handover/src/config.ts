import { z } from "zod";
import { serviceEnv } from "@lib/platform";

export const handoverEnv = serviceEnv.extend({
  PORT: z.coerce.number().int().default(3003),
  /** Development only: seconds of every contest window (refused in production). */
  CLAIM_CONTEST_SECONDS_OVERRIDE: z.string().optional(),
});
