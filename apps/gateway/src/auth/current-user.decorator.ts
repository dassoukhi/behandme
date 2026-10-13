import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";

/** Identity attached to the request by ClerkStrategy. */
export interface AuthUser {
  /** Clerk user ID, also the primary key of the `users` table. */
  id: string;
}

// Clerk IDs are `user_` + alphanumerics. Checked so the id is always safe to
// interpolate into PostgREST filter strings.
const CLERK_ID = /^[A-Za-z0-9_-]+$/;

/** Injects the authenticated user's ID. Never trust user IDs sent by the client. */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const user = context.switchToHttp().getRequest().user as
      AuthUser | undefined;
    if (!user?.id || !CLERK_ID.test(user.id)) {
      throw new UnauthorizedException();
    }
    return user.id;
  },
);
