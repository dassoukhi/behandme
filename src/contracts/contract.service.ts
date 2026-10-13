import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service.js";
import { UsersService } from "../users/users.service.js";
import { CreateContractDTO } from "./dto/create-contract.dto.js";
import { ContractDTO } from "./dto/contract.dto.js";
import { UpdateContractDTO } from "./dto/update-contract.dto.js";
import { ContractValidatorsDTO } from "./dto/contractWtihValidators.dto.js";
import {
  contractRole,
  joinedProfileIds,
  participantFilter,
  projectContract,
} from "./contract-access.js";

const WITH_PARTICIPANTS = `
  *,
  owner:users!contracts_owner_id_fkey(*),
  accessor:users!contracts_accessor_id_fkey(*)`;

/**
 * Access rules: owner, accessor and validators can read a contract; only the
 * owner can update or delete it and see its secret_hash. Contracts the caller
 * cannot see are reported as 404 so their existence is not revealed.
 */
@Injectable()
export class ContractService {
  private readonly logger = new Logger(ContractService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly usersService: UsersService,
  ) {}

  async create(
    me: string,
    createContractDTO: CreateContractDTO,
  ): Promise<ContractDTO> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("contracts")
      // Default applied here, not on the DTO: UpdateContractDTO inherits field initializers.
      .insert([
        {
          blockchain_network: "Fabric-Network",
          ...createContractDTO,
          owner_id: me,
        },
      ])
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create contract: ${error.message}`);
      throw error;
    }

    return data;
  }

  async findAll(me: string): Promise<ContractDTO[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("contracts")
      .select(WITH_PARTICIPANTS)
      .or(participantFilter(me));

    if (error) {
      this.logger.error(`Failed to fetch contracts: ${error.message}`);
      throw error;
    }

    const contracts = (data ?? []) as ContractDTO[];
    const trustingMe = await this.usersService.whoTrusts(
      me,
      joinedProfileIds(contracts),
    );
    return contracts.map((c) => projectContract(c, me, trustingMe));
  }

  async findOne(me: string, id: string): Promise<ContractValidatorsDTO> {
    const client = this.supabaseService.getClient();
    const { data: contract, error } = await client
      .from("contracts")
      .select(WITH_PARTICIPANTS)
      .eq("id", id)
      .maybeSingle<ContractValidatorsDTO>();

    if (error) {
      this.logger.error(`Failed to fetch contract: ${error.message}`);
      throw error;
    }
    if (!contract || !contractRole(contract, me)) {
      throw new NotFoundException(`Contract with ID ${id} not found`);
    }

    contract.validators_list = [];
    if (contract.validators?.length) {
      const { data: validators, error: validatorsError } = await client
        .from("users")
        .select("*")
        .in("id", contract.validators);

      if (validatorsError) throw validatorsError;

      // Keep the order of the validators array
      contract.validators_list = contract.validators
        .map((validatorId) => validators.find((u) => u.id === validatorId))
        .filter(Boolean);
    }

    const trustingMe = await this.usersService.whoTrusts(
      me,
      joinedProfileIds([contract]),
    );
    return projectContract(contract, me, trustingMe);
  }

  async update(
    me: string,
    id: string,
    updateContractDTO: UpdateContractDTO,
  ): Promise<ContractDTO> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("contracts")
      .update(updateContractDTO)
      .eq("id", id)
      .eq("owner_id", me)
      .select()
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to update contract: ${error.message}`);
      throw error;
    }
    if (!data) {
      throw new NotFoundException(`Contract with ID ${id} not found`);
    }

    return data;
  }

  async remove(me: string, id: string): Promise<{ message: string }> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("contracts")
      .delete()
      .eq("id", id)
      .eq("owner_id", me)
      .select("id");

    if (error) {
      this.logger.error(`Failed to delete contract: ${error.message}`);
      throw error;
    }
    if (!data?.length) {
      throw new NotFoundException(`Contract with ID ${id} not found`);
    }

    return { message: `Contract with ID ${id} deleted successfully` };
  }
}
