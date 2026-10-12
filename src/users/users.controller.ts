import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserProfileDto } from "./dto/user-profile.dto";
import { AddTrustedDto } from "./dto/add-trusted.dto";

@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: "Create a new user profile" })
  @ApiResponse({
    status: 201,
    description: "Profile created successfully",
    type: UserProfileDto,
  })
  @ApiResponse({ status: 400, description: "Bad request" })
  create(@Body() createUserDto: CreateUserDto): Promise<UserProfileDto> {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @ApiOperation({ summary: "Get all user profiles" })
  @ApiResponse({
    status: 200,
    description: "Return all profiles",
    type: [UserProfileDto],
  })
  findAll(): Promise<UserProfileDto[]> {
    return this.usersService.findAll();
  }

  // ⚠️ IMPORTANT: Cette route doit être AVANT /:id
  @Get("search")
  @ApiOperation({ summary: "Search users by first_name, last_name or email" })
  @ApiQuery({ name: "q", required: true, description: "Search query" })
  @ApiQuery({
    name: "excludeId",
    required: false,
    description: "ID of the current user to exclude from results",
  })
  @ApiResponse({
    status: 200,
    description: "Return matching profiles",
    type: [UserProfileDto],
  })
  searchUsers(
    @Query("q") query: string,
    @Query("excludeId") excludeId?: string
  ): Promise<UserProfileDto[]> {
    return this.usersService.searchUsers(query, excludeId);
  }

  // ⚠️ Cette route doit être AVANT getTrusteds/:id aussi
  @Get("getTrusteds/:id")
  @ApiOperation({ summary: "Get Trusteds by owner_id" })
  @ApiResponse({
    status: 200,
    description: "Return all Trusteds",
    type: [UserProfileDto],
  })
  getTrusteds(@Param("id") id: string): Promise<UserProfileDto[]> {
    return this.usersService.getTrusteds(id);
  }

  // Cette route dynamique /:id doit être EN DERNIER des routes GET
  @Get(":id")
  @ApiOperation({ summary: "Get a user profile by ID" })
  @ApiResponse({
    status: 200,
    description: "Return the profile",
    type: UserProfileDto,
  })
  @ApiResponse({ status: 404, description: "Profile not found" })
  findOne(@Param("id") id: string): Promise<UserProfileDto> {
    return this.usersService.findOne(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a user profile" })
  @ApiResponse({
    status: 200,
    description: "Profile updated successfully",
    type: UserProfileDto,
  })
  @ApiResponse({ status: 404, description: "Profile not found" })
  update(
    @Param("id") id: string,
    @Body() updateUserDto: UpdateUserDto
  ): Promise<UserProfileDto> {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a user profile" })
  @ApiResponse({ status: 200, description: "Profile deleted successfully" })
  @ApiResponse({ status: 404, description: "Profile not found" })
  remove(@Param("id") id: string): Promise<{ message: string }> {
    return this.usersService.remove(id);
  }

  @Post("addTrusted")
  @ApiOperation({ summary: "Add a new trusted" })
  @ApiResponse({
    status: 201,
    description: "Trusted added successfully",
    type: AddTrustedDto,
  })
  @ApiResponse({ status: 400, description: "Bad request" })
  addTrusted(@Body() addTrustedDto: AddTrustedDto): Promise<AddTrustedDto> {
    return this.usersService.addTrusted(addTrustedDto);
  }
}
