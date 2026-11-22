import { Controller, Get, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ImagensService } from './imagens.service.js';

@Controller('imagens')
export class ImagensController {
  constructor(private readonly imagens: ImagensService) {}

  // Foto ilustrativa de um prato, pelo id do DishImage. O app monta a <img> com esta URL
  @Get(':id')
  obter(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response, // passthrough: o Nest ainda devolve o retorno do método
  ) {
    return this.imagens.servir(id, req, res);
  }
}
