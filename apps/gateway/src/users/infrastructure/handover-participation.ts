import { Inject, Injectable } from "@nestjs/common";
import {
  HANDOVER_CLIENT,
  type HandoverClient,
} from "../../handover/application/handover-client.js";
import type { ContractParticipation } from "../application/ports.js";

/** Asks handover, which owns contracts, for the user's roles. */
@Injectable()
export class HandoverParticipation implements ContractParticipation {
  constructor(
    @Inject(HANDOVER_CLIENT) private readonly handover: HandoverClient,
  ) {}

  async takesPartInOthersContracts(userId: string): Promise<boolean> {
    const contracts = await this.handover.list(userId);
    return contracts.some((contract) => contract.my_role !== "owner");
  }
}
