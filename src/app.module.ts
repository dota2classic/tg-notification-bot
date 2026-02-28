import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { StorageModule } from './storage/storage.module';
import { BotModule } from './bot/bot.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        level: process.env.LOG_LEVEL || 'info',
      },
    }),
    StorageModule.forRoot(),
    BotModule,
  ],
})
export class AppModule {}
