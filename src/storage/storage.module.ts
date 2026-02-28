import { Module, Global, DynamicModule, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './storage.service';
import { MemoryStorageService } from './memory.service';
import { RedisService } from '../redis/redis.service';

const logger = new Logger('StorageModule');

@Global()
@Module({})
export class StorageModule {
  static forRoot(): DynamicModule {
    const useMemory = process.env.USE_MEMORY_STORAGE === 'true';

    if (useMemory) {
      logger.log('Using in-memory storage backend');
      return {
        module: StorageModule,
        providers: [
          {
            provide: StorageService,
            useClass: MemoryStorageService,
          },
        ],
        exports: [StorageService],
      };
    }

    logger.log('Using Redis storage backend');
    return {
      module: StorageModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: StorageService,
          useClass: RedisService,
        },
      ],
      exports: [StorageService],
    };
  }
}
