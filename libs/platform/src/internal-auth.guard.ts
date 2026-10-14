import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { type InternalCaller, verifyInternalToken } from "./internal-token.js";

export interface InternalAuthOptions {
  secret: string;
  /** This service's name: tokens for another audience are refused. */
  audience: string;
}
export const INTERNAL_AUTH_OPTIONS = Symbol("InternalAuthOptions");

const OPEN_ROUTE = "platform:openRoute";
/** A route reachable without any authentication (health checks). Honoured by every service's guard. */
export const OpenRoute = () => SetMetadata(OPEN_ROUTE, true);

export function isOpenRoute(
  reflector: Reflector,
  context: ExecutionContext,
): boolean {
  return (
    reflector.getAllAndOverride<boolean>(OPEN_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}

type WithCaller = Request & { caller?: InternalCaller };

/** Global guard of an internal service: every route needs a valid internal token. */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(INTERNAL_AUTH_OPTIONS)
    private readonly options: InternalAuthOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isOpenRoute(this.reflector, context)) return true;

    const request = context.switchToHttp().getRequest<WithCaller>();
    const [scheme, token] = (request.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException("Missing internal token");
    }
    try {
      request.caller = await verifyInternalToken(
        this.options.secret,
        token,
        this.options.audience,
      );
    } catch {
      throw new UnauthorizedException("Invalid internal token");
    }
    return true;
  }
}

/** Id of the user an internal request acts for; 401 when the token names none. */
export const ForUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const userId = context.switchToHttp().getRequest<WithCaller>()
      .caller?.userId;
    if (!userId) {
      throw new UnauthorizedException("The internal token names no user");
    }
    return userId;
  },
);
