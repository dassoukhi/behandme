import { z } from "zod";
import { serviceEnv } from "@lib/platform";

export const workerEnv = serviceEnv.extend({
  /** Health check only: the worker has no API. */
  PORT: z.coerce.number().int().default(3002),
});
