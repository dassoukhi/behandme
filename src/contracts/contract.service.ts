import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service.js";
import { ContractDTO } from "./dto/contract.dto.js";
import { CreateContractDTO } from "./dto/create-contract.dto.js";
import { UpdateContractDTO } from "./dto/update-contract.dto.js";
import { ContractValidatorsDTO } from "./dto/contractWtihValidators.dto.js";

@Injectable()
export class ContractService {
  private readonly logger = new Logger(ContractService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async create(createContractDTO: CreateContractDTO): Promise<ContractDTO> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("contracts")
      .insert([createContractDTO])
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create user: ${error.message}`);
      throw error;
    }

    return data;
  }

  async findAll(): Promise<ContractDTO[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("contracts").select(`
        *,
        owner:users!contracts_owner_id_fkey(*),
        accessor:users!contracts_accessor_id_fkey(*)`);

    if (error) {
      this.logger.error(`Failed to fetch Contracts: ${error.message}`);
      throw error;
    }
    console.log("data:", data);

    return data;
  }

  async findOne(id: string): Promise<ContractValidatorsDTO> {
    const { data: contract, error } = await this.supabaseService
      .getClient()
      .from("contracts")
      .select(
        `
        *,
        owner:users!contracts_owner_id_fkey(*),
        accessor:users!contracts_accessor_id_fkey(*)`,
      )
      .eq("id", id)
      .single<ContractValidatorsDTO>();

    if (error) {
      this.logger.error(`Failed to fetch Contract: ${error.message}`);
      throw new NotFoundException(`Contract with ID ${id} not found`);
    }
    if (contract?.validators && contract.validators.length > 0) {
      const { data: validators, error: validatorsError } =
        await this.supabaseService
          .getClient()
          .from("users")
          .select("*")
          .in("id", contract.validators);

      if (validatorsError) throw validatorsError;

      // Maintenir l'ordre des validators selon le tableau original
      contract.validators_list = contract.validators
        .map((id) => validators.find((user) => user.id === id))
        .filter(Boolean);
    } else {
      contract.validators_list = [];
    }

    return contract;
  }

  async update(
    id: string,
    updateContractDTO: UpdateContractDTO,
  ): Promise<ContractDTO> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("contracts")
      .update(updateContractDTO)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to update user: ${error.message}`);
      throw error;
    }

    if (!data) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return data;
  }

  async remove(id: string): Promise<{ message: string }> {
    const { error } = await this.supabaseService
      .getClient()
      .from("contracts")
      .delete()
      .eq("id", id);

    if (error) {
      this.logger.error(`Failed to delete user: ${error.message}`);
      throw error;
    }

    return { message: `User with ID ${id} deleted successfully` };
  }
}
