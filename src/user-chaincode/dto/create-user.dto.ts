import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail, IsNotEmpty } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: 'ID unique de l\'utilisateur', example: 'user4' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Nom d\'utilisateur', example: 'elise' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ description: 'Adresse e-mail de l\'utilisateur', example: 'elise@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'Rôle de l\'utilisateur', example: 'user' })
  @IsString()
  @IsNotEmpty()
  role: string;
}
