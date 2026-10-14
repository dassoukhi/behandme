import { createHash } from "node:crypto";
import type { Sha256Hex } from "../application/ports.js";

export const nodeSha256: Sha256Hex = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");
