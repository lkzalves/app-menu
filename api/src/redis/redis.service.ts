import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

// Cliente Redis da aplicação (cache e pub/sub). É o próprio ioredis: injete e use .get/.set/.publish.
// A conexão das filas é outra, configurada no BullModule
@Injectable()
export class RedisService extends Redis implements OnApplicationShutdown {
  constructor(config: ConfigService) {
    super(config.getOrThrow<string>('REDIS_URL'));
  }

  async onApplicationShutdown() {
    await this.quit();
  }
}
