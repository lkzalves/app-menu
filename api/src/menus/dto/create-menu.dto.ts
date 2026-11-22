import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMenuDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  restaurante?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10) // ex.: pt, en-US
  idioma?: string;
}
