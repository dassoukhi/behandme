import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import type {
  AuditEvent,
  ChainVerification,
  ContractRecord,
  ReleasePackage,
  SealedMaterial,
} from "@lib/contracts";
import { ForUser } from "@lib/platform";
import { ClaimsService } from "../application/claims.service.js";
import { ContractsService } from "../application/contracts.service.js";
import { SealingService } from "../application/sealing.service.js";
import type { RegisteredKey } from "../domain/sealing.js";
import {
  ContractChangesDto,
  DecisionDto,
  NewContractDto,
  RegisteredKeyDto,
  RevokeDto,
  SealDto,
} from "./dto/inputs.dto.js";

const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));

const registeredKey = (k: RegisteredKeyDto): RegisteredKey => ({
  keyVersion: k.key_version,
  fingerprint: k.fingerprint,
  signingPublicKey: bytes(k.signing_public_key),
  usableFrom: new Date(k.usable_from),
});

// Internal API, called by the gateway only (internal token, whose subject is the user). The gateway
// has already checked that the participants of a new contract are people the user trusts.

@Controller("contracts")
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly sealing: SealingService,
    private readonly claims: ClaimsService,
  ) {}

  @Get()
  list(@ForUser() me: string): Promise<ContractRecord[]> {
    return this.contracts.list(me);
  }

  @Post()
  create(
    @ForUser() me: string,
    @Body() body: NewContractDto,
  ): Promise<ContractRecord> {
    return this.contracts.create(me, {
      category: body.category,
      description: body.description ?? null,
      accessorId: body.accessor_id,
      validatorIds: body.validator_ids,
      contestDays: body.contest_days,
    });
  }

  @Get(":id")
  get(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ContractRecord> {
    return this.contracts.get(me, id);
  }

  @Patch(":id")
  update(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() changes: ContractChangesDto,
  ): Promise<ContractRecord> {
    return this.contracts.update(me, id, {
      category: changes.category,
      description: changes.description,
      contestDays: changes.contest_days,
    });
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.contracts.remove(me, id);
  }

  @Post(":id/seal")
  @HttpCode(200)
  seal(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: SealDto,
  ): Promise<ContractRecord> {
    const keys = new Map<string, RegisteredKey>(
      body.registered_keys.map((k) => [k.user_id, registeredKey(k)]),
    );
    return this.sealing.seal(
      me,
      id,
      {
        expectedVersion: body.expected_version,
        accessorId: body.accessor_id,
        validatorIds: body.validator_ids,
        envelope: bytes(body.envelope),
        ownerWrap: bytes(body.owner_wrap),
        shares: body.shares.map((s) => ({
          userId: s.user_id,
          index: s.index,
          keyVersion: s.key_version,
          wrap: bytes(s.wrap),
        })),
        manifest: body.manifest,
        manifestSignature: bytes(body.manifest_signature),
      },
      keys,
    );
  }

  @Get(":id/sealed")
  sealed(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<SealedMaterial> {
    return this.sealing.material(me, id);
  }

  @Post(":id/revoke")
  @HttpCode(200)
  revoke(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() { expected_version }: RevokeDto,
  ): Promise<ContractRecord> {
    return this.sealing.revoke(me, id, expected_version);
  }

  @Post(":id/claims")
  @HttpCode(200)
  fileClaim(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ContractRecord> {
    return this.claims.file(me, id);
  }

  @Post(":id/claims/:claimId/cancel")
  @HttpCode(200)
  cancelClaim(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("claimId", ParseUUIDPipe) claimId: string,
  ): Promise<ContractRecord> {
    return this.claims.cancel(me, id, claimId);
  }

  @Post(":id/claims/:claimId/withdraw")
  @HttpCode(200)
  withdrawClaim(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("claimId", ParseUUIDPipe) claimId: string,
  ): Promise<ContractRecord> {
    return this.claims.withdraw(me, id, claimId);
  }

  @Post(":id/claims/:claimId/decision")
  @HttpCode(200)
  decide(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("claimId", ParseUUIDPipe) claimId: string,
    @Body() body: DecisionDto,
  ): Promise<ContractRecord> {
    return this.claims.decide(
      me,
      id,
      claimId,
      {
        approve: body.approve,
        releaseWrap: body.release_wrap ? bytes(body.release_wrap) : undefined,
        accessorKeyVersion: body.accessor_key_version,
      },
      body.accessor_key ? registeredKey(body.accessor_key) : undefined,
    );
  }

  @Get(":id/release")
  release(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ReleasePackage> {
    return this.claims.releasePackage(me, id);
  }

  @Get(":id/events")
  events(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<AuditEvent[]> {
    return this.contracts.events(me, id);
  }

  @Get(":id/events/verify")
  verify(
    @ForUser() me: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ChainVerification> {
    return this.contracts.verify(me, id);
  }
}
