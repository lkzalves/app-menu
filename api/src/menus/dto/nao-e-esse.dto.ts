import { IsUUID } from 'class-validator';

export class NaoEEsseDto {
  // A foto que o cliente viu e rejeitou (dish.imagens[].id do GET /menus/:id)
  @IsUUID()
  imagemId: string;
}
