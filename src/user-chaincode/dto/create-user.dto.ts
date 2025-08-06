import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail, IsNotEmpty } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: 'ID unique de l\'utilisateur', example: 'user4' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'status', example: 'active' })
  @IsString()
  status: string;

}
