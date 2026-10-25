import { type ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { isOpenRoute } from "@lib/platform";

/** Requests per minute for one person on any route, and on the user search (who uses the app). */
export const RATE_LIMIT = {
  perMinute: 120,
  searchPerMinute: 30,
  windowMs: 60_000,
};

/**
 * Counts requests per signed-in user (the Clerk id ClerkAuthGuard sets, which runs first), else per
 * client address: on a mobile network many people share one address, and behind Railway's proxy
 * everyone would. Open routes (the host's health check) are never limited.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, any>,
  ): Promise<string> {
    return (req.user as { id?: string } | undefined)?.id ?? req.ip;
  }

  protected override async shouldSkip(
    context: ExecutionContext,
  ): Promise<boolean> {
    return isOpenRoute(this.reflector, context) || super.shouldSkip(context);
  }
}
