import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserProfileDto } from './dto/user-profile.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async create(createUserDto: CreateUserDto): Promise<UserProfileDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('profiles')
      .insert([createUserDto])
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create user: ${error.message}`);
      throw error;
    }

    return data;
  }

  async findAll(): Promise<UserProfileDto[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('profiles')
      .select('*');

    if (error) {
      this.logger.error(`Failed to fetch users: ${error.message}`);
      throw error;
    }

    return data;
  }

  async findOne(id: string): Promise<UserProfileDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      this.logger.error(`Failed to fetch user: ${error.message}`);
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return data;
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserProfileDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('profiles')
      .update(updateUserDto)
      .eq('id', id)
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
      .from('profiles')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Failed to delete user: ${error.message}`);
      throw error;
    }

    return { message: `User with ID ${id} deleted successfully` };
  }
}