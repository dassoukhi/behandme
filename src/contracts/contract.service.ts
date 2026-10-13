import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
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

// Explicit columns: legacy secret/blockchain/meta columns are never read back.
const CONTRACT_COLUMNS =
  "id, name, description, owner_id, accessor_id, validators, status, created_at, updated_at";
const WITH_PARTICIPANTS = `
  ${CONTRACT_COLUMNS},
  owner:users!contracts_owner_id_fkey(*),
  accessor:users!contracts_accessor_id_fkey(*)`;

/**
 * Access rules: owner, accessor and validators can read a contract; only the
 * owner can update or delete it. Contracts the caller cannot see are reported
 * as 404 so their existence is not revealed. Participants must be people the
 * owner trusts; status and secret material are never set by the client.
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
    await this.assertValidParticipants(me, createContractDTO);

    const { data, error } = await this.supabaseService
      .getClient()
      .from("contracts")
      .insert([
        {
          name: createContractDTO.name,
          description: createContractDTO.description ?? null,
          accessor_id: createContractDTO.accessor_id,
          validators: createContractDTO.validators,
          owner_id: me,
        },
      ])
      .select(CONTRACT_COLUMNS)
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

    // PostgREST types embedded relations as arrays; the FK joins return one row.
    const contracts = (data ?? []) as unknown as ContractDTO[];
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
      .select(CONTRACT_COLUMNS)
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

  /**
   * Accessor and validators must be distinct people the owner trusts, and the
   * owner cannot hold another role on their own contract.
   */
  private async assertValidParticipants(
    me: string,
    { accessor_id, validators }: CreateContractDTO,
  ): Promise<void> {
    const participants = [accessor_id, ...validators];
    if (participants.includes(me)) {
      throw new BadRequestException(
        "You cannot be the accessor or a validator of your own contract",
      );
    }
    if (validators.includes(accessor_id)) {
      throw new BadRequestException("The accessor cannot also be a validator");
    }
    const trusted = await this.usersService.trustedAmong(me, participants);
    const untrusted = participants.filter((id) => !trusted.has(id));
    if (untrusted.length) {
      throw new BadRequestException(
        "Accessor and validators must be people you trust",
      );
    }
  }
}
