import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.menusService.findOne(id);
  }
}
