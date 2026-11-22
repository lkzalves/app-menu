import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // CORS: o app roda em outra origem (Ionic em :8100, Angular em :4200). Lista separada por vírgula
  app.enableCors({
    origin: (
      process.env.CORS_ORIGIN ?? 'http://localhost:8100,http://localhost:4200'
    ).split(','),
  });
  // Faz o Ctrl+C/SIGTERM rodar o encerramento (workers, Redis e streams SSE abertos)
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
