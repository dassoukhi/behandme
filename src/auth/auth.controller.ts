import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Headers,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";

import { AuthService } from "./auth.service.js";
import { SignUpDto } from "./dto/sign-up.dto.js";
import { SignInDto } from "./dto/sign-in.dto.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("sign-up")
  @ApiOperation({ summary: "Register a new user" })
  @ApiResponse({ status: 201, description: "User successfully registered" })
  @ApiResponse({ status: 400, description: "Bad request" })
  signUp(@Body() signUpDto: SignUpDto) {
    return this.authService.signUp(signUpDto);
  }

  @Post("sign-in")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "User sign in" })
  @ApiResponse({ status: 200, description: "User successfully signed in" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  signIn(@Body() signInDto: SignInDto) {
    return this.authService.signIn(signInDto);
  }

  @Post("sign-out")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "User sign out" })
  @ApiResponse({ status: 200, description: "User successfully signed out" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  signOut(@Headers("authorization") authorization: string) {
    const token = authorization?.split(" ")[1];
    return this.authService.signOut(token);
  }
}
