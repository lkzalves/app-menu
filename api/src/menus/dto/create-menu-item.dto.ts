import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { normalizarPreco } from '../preco.util.js';

export class CreateMenuItemDto {
  @IsInt()
  @Min(0)
  ordem: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nomeOriginal: string;

  @IsOptional()
  @IsString()
  nomeTraduzido?: string;

  @IsOptional()
  @IsString()
  descricao?: string;

  // Aceita 12.5, "12,50", "R$ 12,50"... e chega no service como string com ponto
  @IsOptional()
  @Transform(({ value }) => normalizarPreco(value))
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, { message: 'preco inválido' })
  preco?: string;
}
