import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { uploadToDisk } from '@nestjs/storage';
import type { StoredUpload } from '@nestjs/storage';
import { CreateMenuItemDto } from './dto/create-menu-item.dto.js';
import { CreateMenuDto } from './dto/create-menu.dto.js';
import { MarcarPratosDto } from './dto/marcar-pratos.dto.js';
import { MenusService } from './menus.service.js';

@Controller('menus')
export class MenusController {
  constructor(private readonly menusService: MenusService) {}

  @Post()
  create(@Body() dto: CreateMenuDto) {
    return this.menusService.create(dto);
  }

  @Get()
  findAll() {
    return this.menusService.findAll();
  }

  // ParseUUIDPipe: id que não é UUID responde 400 antes de chegar no banco
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.menusService.findOne(id);
  }

  @Post(':id/itens')
  addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMenuItemDto,
  ) {
    return this.menusService.addItem(id, dto);
  }

  // Recebe os retângulos que o cliente circulou e cria um prato por recorte lido
  @Post(':id/pratos')
  @HttpCode(200) // substitui a lista de pratos, então 200 em vez de 201
  marcarPratos(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarcarPratosDto,
  ) {
    return this.menusService.marcarPratos(id, dto.regioes);
  }

  // Roda o OCR na foto já enviada e guarda o texto bruto em Menu.textoOcr
  @Post(':id/ocr')
  @HttpCode(200) // não cria recurso novo, então 200 em vez do 201 padrão do POST
  executarOcr(@Param('id', ParseUUIDPipe) id: string) {
    return this.menusService.executarOcr(id);
  }

  // Multipart, campo "foto". O tipo é checado pelos bytes da imagem (415 se não for imagem aceita)
  @Post(':id/foto')
  @UseInterceptors(
    FileInterceptor('foto', {
      storage: uploadToDisk({
        disk: 'fotos',
        contentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
      }),
      limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10 MB; acima disso, 413
    }),
  )
  anexarFoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() foto?: StoredUpload,
  ) {
    if (!foto) throw new BadRequestException('Envie a imagem no campo "foto"');
    return this.menusService.anexarFoto(id, foto.key);
  }
}
