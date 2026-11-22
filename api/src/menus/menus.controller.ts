import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
