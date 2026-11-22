import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { IMAGE_PROVIDERS, ImageProvider } from './image.provider.js';
import { ImagensController } from './imagens.controller.js';
import { ImagensService } from './imagens.service.js';
import { PixabayProvider } from './pixabay.provider.js';

@Module({
  imports: [PrismaModule],
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
  ],
  exports: [ImagensService],
})
export class ImagensModule {}
