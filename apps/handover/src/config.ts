import { z } from "zod";
import { serviceEnv } from "@lib/platform";

export const handoverEnv = serviceEnv.extend({
  PORT: z.coerce.number().int().default(3003),
});
