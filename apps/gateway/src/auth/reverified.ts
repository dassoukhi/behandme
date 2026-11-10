import { reverificationError } from "@clerk/backend/internal";
import { ForbiddenException } from "@nestjs/common";
import {
  RESET_REVERIFICATION,
  ReverificationRequired,
} from "./domain/reverification.js";

/**
 * Runs a route's action that needs a recent Clerk reverification: when the session's is too old, the 403 body
 * is Clerk's reverification hint (clerk_error), which the app's useReverification handles.
 */
export async function reverified<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ReverificationRequired) {
      throw new ForbiddenException(reverificationError(RESET_REVERIFICATION));
    }
    throw error;
  }
}
