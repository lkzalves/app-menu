import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Min, ValidateNested } from 'class-validator';

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

export class MarcarPratosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true }) // valida cada item da lista com as regras do RegiaoDto
  @Type(() => RegiaoDto) // sem isso o class-transformer deixa os itens como objetos soltos
  regioes: RegiaoDto[];
}
