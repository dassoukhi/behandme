import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail, IsNotEmpty } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: 'ID unique de l\'utilisateur', example: 'user4' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Nom d\'utilisateur', example: 'elise Elloi' })
  @IsString()
  @IsNotEmpty()
  username: string;



  @ApiProperty({ description: 'Nom d\'utilisateur', example: 'Elloi' })
  @IsString()
  @IsNotEmpty()
  firstName: string;


  @ApiProperty({ description: 'Nom d\'utilisateur', example: 'elise' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ description: 'Adresse e-mail de l\'utilisateur', example: 'elise@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'Adresse de l\'utilisateur', example: '5 rue Jean Elise,75000 Paris' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ description: 'Numero de portable', example: '+33999333399' })
  @IsString()
  @IsNotEmpty()
  phone: string;


  @ApiProperty({ description: 'Numero de portable', example: '+33999333399' })
  @IsString()
  status: string;

  @ApiProperty({ description: 'Rôle de l\'utilisateur', example: 'user' })
  @IsString()
  @IsNotEmpty()
  role: string;
}
