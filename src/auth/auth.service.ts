import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service.js";
import { SignUpDto } from "./dto/sign-up.dto.js";
import { SignInDto } from "./dto/sign-in.dto.js";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async signUp(signUpDto: SignUpDto) {
    const { email, password } = signUpDto;

    const { data, error } = await this.supabaseService
      .getClient()
      .auth.signUp({ email, password });

    if (error) {
      this.logger.error(`Sign up failed: ${error.message}`);
      throw new UnauthorizedException(error.message);
    }

    return {
      message: "User registered successfully",
      user: data.user,
    };
  }

  async signIn(signInDto: SignInDto) {
    const { email, password } = signInDto;

    const { data, error } = await this.supabaseService
      .getClient()
      .auth.signInWithPassword({ email, password });

    if (error) {
      this.logger.error(`Sign in failed: ${error.message}`);
      throw new UnauthorizedException("Invalid credentials");
    }

    return {
      user: data.user,
      session: data.session,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- token is ignored, so the caller's session isn't revoked
  async signOut(token: string) {
    const { error } = await this.supabaseService.getClient().auth.signOut();

    if (error) {
      this.logger.error(`Sign out failed: ${error.message}`);
      throw new UnauthorizedException(error.message);
    }

    return {
      message: "Sign out successful",
    };
  }
}
