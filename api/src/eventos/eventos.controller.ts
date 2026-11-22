import {
  Controller,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { EventosService } from './eventos.service.js';

@Controller('menus')
export class EventosController {
  constructor(private readonly eventos: EventosService) {}

  // Server-Sent Events: o app abre com EventSource e refaz GET /menus/:id a cada evento.
  // Abra o stream ANTES de marcar os pratos; ao receber "ready", faça o primeiro GET
  @Sse(':id/eventos')
  async eventosDoMenu(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Observable<MessageEvent>> {
    await this.eventos.garantirMenu(id); // 404 antes de abrir o stream
    return this.eventos.fluxo(id);
  }
}
