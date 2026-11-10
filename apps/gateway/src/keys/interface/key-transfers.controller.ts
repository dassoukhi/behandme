import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  CurrentUserId,
  CurrentVerificationAge,
} from "../../auth/current-user.decorator.js";
import { reverified } from "../../auth/reverified.js";
import { KeyTransferService } from "../application/key-transfer.service.js";
import { fromBase64 } from "./base64.js";
import {
  DepositKeyTransferDto,
  KeyTransferDto,
  OpenKeyTransferDto,
  TakenKeyTransferDto,
} from "./dto/key-transfers.dto.js";

// Keys from the old phone to a new one (docs/crypto-protocol.md in the app, "Moving keys to a new phone").
@ApiTags("keys")
@ApiBearerAuth()
@Controller("users/me/key-transfers")
export class KeyTransfersController {
  constructor(private readonly transfers: KeyTransferService) {}

  @Post()
  @ApiOperation({
    summary:
      "The new phone opens a transfer to a key it made. Needs a Clerk verification less than 10 minutes old; replaces the user's other transfers; open 5 minutes.",
  })
  @ApiResponse({ status: 201, type: KeyTransferDto })
  @ApiResponse({ status: 400, description: "Not an X-Wing public key" })
  @ApiResponse({
    status: 403,
    description:
      "Reverification needed: the body is Clerk's reverification hint (clerk_error)",
  })
  @ApiResponse({ status: 404, description: "No keys to move" })
  async open(
    @CurrentUserId() me: string,
    @CurrentVerificationAge() fva: [number, number] | null,
    @Body() body: OpenKeyTransferDto,
  ): Promise<KeyTransferDto> {
    return reverified(() =>
      this.transfers.open(me, fromBase64(body.recipient_key), fva),
    );
  }

  @Get(":id")
  @ApiOperation({ summary: "An open transfer of the caller's" })
  @ApiResponse({ status: 200, type: KeyTransferDto })
  @ApiResponse({ status: 404, description: "No such transfer, or it expired" })
  find(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<KeyTransferDto> {
    return this.transfers.find(me, id);
  }

  @Patch(":id")
  @ApiOperation({
    summary:
      "The old phone sends the keys, wrapped to the new phone's key (the server cannot open them). Once.",
  })
  @ApiResponse({ status: 200, type: KeyTransferDto })
  @ApiResponse({ status: 400, description: "Not a transfer wrap" })
  @ApiResponse({ status: 404, description: "No such transfer, or it expired" })
  @ApiResponse({
    status: 409,
    description:
      "The keys changed meanwhile, or this transfer holds keys already",
  })
  deposit(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: DepositKeyTransferDto,
  ): Promise<KeyTransferDto> {
    return this.transfers.deposit(
      me,
      id,
      body.key_version,
      fromBase64(body.wrap),
    );
  }

  @Post(":id/take")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "The new phone takes the keys the old one sent; the transfer is then gone and the user alerted",
  })
  @ApiResponse({ status: 200, type: TakenKeyTransferDto })
  @ApiResponse({ status: 404, description: "No such transfer, or it expired" })
  @ApiResponse({
    status: 409,
    description: "The old phone has not sent the keys yet",
  })
  take(
    @CurrentUserId() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<TakenKeyTransferDto> {
    return this.transfers.take(me, id);
  }
}
