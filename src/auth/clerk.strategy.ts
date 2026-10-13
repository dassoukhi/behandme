import { verifyToken } from "@clerk/backend";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-custom";
import { Request } from "express";
import type { AuthUser } from "./current-user.decorator.js";

@Injectable()
export class ClerkStrategy extends PassportStrategy(Strategy, "clerk") {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  async validate(req: Request): Promise<AuthUser> {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

    if (!token) {
      throw new UnauthorizedException("No token provided");
    }

    try {
      // The verified session token is enough to identify the user; no Clerk API call.
      const payload = await verifyToken(token, {
        secretKey: this.configService.get("CLERK_SECRET_KEY"),
      });
      return { id: payload.sub };
    } catch {
      throw new UnauthorizedException("Invalid token");
    }
  }
}
