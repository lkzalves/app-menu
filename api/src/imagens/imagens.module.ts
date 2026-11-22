import { Module } from '@nestjs/common';
import { EventosModule } from '../eventos/eventos.module.js';
import { FilaModule } from '../fila/fila.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { IMAGE_PROVIDERS, ImageProvider } from './image.provider.js';
import { ImagensController } from './imagens.controller.js';
import { ImagensProcessor } from './imagens.processor.js';
import { ImagensService } from './imagens.service.js';
import { PixabayProvider } from './pixabay.provider.js';

@Module({
  imports: [PrismaModule, FilaModule, EventosModule, RedisModule],
  controllers: [ImagensController],
  providers: [
    PixabayProvider,
    // A cadeia de fontes, em ordem. Wikidata, Brave etc. entram aqui quando existirem
    {
      provide: IMAGE_PROVIDERS,
      useFactory: (pixabay: PixabayProvider): ImageProvider[] => [pixabay],
      inject: [PixabayProvider],
    },
    ImagensService,
    ImagensProcessor, // o worker da fila "imagens"
  ],
  exports: [ImagensService],
})
export class ImagensModule {}
