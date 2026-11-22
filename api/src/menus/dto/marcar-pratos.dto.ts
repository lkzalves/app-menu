import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

// Retângulo em pixels da foto enviada
export class RegiaoDto {
  @IsInt()
  @Min(0)
  x: number;

  @IsInt()
  @Min(0)
  y: number;

  @IsInt()
  @Min(1)
  largura: number;

  @IsInt()
  @Min(1)
  altura: number;
}

// Um prato circulado (amarelo) e as linhas de ingredientes circuladas para ele (vermelho)
export class GrupoPratoDto {
  @IsDefined() // o ValidateNested sozinho deixa passar o campo ausente
  @ValidateNested() // valida o objeto aninhado com as regras do RegiaoDto
  @Type(() => RegiaoDto) // sem isso o class-transformer deixa o valor como objeto solto
  prato: RegiaoDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5) // uma região por linha de texto
  @ValidateNested({ each: true })
  @Type(() => RegiaoDto)
  ingredientes?: RegiaoDto[];
}

export class MarcarPratosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true }) // valida cada grupo com as regras do GrupoPratoDto
  @Type(() => GrupoPratoDto)
  grupos: GrupoPratoDto[];
}
