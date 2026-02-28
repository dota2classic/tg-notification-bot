import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { StorageService } from '../storage/storage.service';
import { User } from '../bot/bot.types';

const USERS_KEY = 'tg_bot:users';

@Injectable()
export class RedisService extends StorageService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  protected readonly logger = new Logger(RedisService.name);

  constructor(private config: ConfigService) {
    super();
  }

  async onModuleInit() {
    const host = this.config.get('REDIS_HOST', 'localhost');
    const port = this.config.get('REDIS_PORT', 6379);

    this.client = createClient({
      socket: { host, port },
      password: this.config.get('REDIS_PASSWORD'),
    });

    this.client.on('error', (err) => this.logger.error('Redis client error', err));
    await this.client.connect();
    this.logger.log(`Connected to Redis at ${host}:${port}`);
  }

  async onModuleDestroy() {
    await this.client.quit();
    this.logger.log('Disconnected from Redis');
  }

  async getUser(chatId: string | number): Promise<User | null> {
    const data = await this.client.hGet(USERS_KEY, String(chatId));
    if (!data) return null;

    const user = this.safeJsonParse<User>(data);
    if (!user) {
      this.logger.warn(`Corrupted user data for chatId=${chatId}, returning null`);
    }
    return user;
  }

  async setUser(chatId: string | number, user: User): Promise<void> {
    await this.client.hSet(USERS_KEY, String(chatId), JSON.stringify(user));
  }

  async getAllUsers(): Promise<Record<string, User>> {
    const data = await this.client.hGetAll(USERS_KEY);
    const users: Record<string, User> = {};
    let parseErrors = 0;

    for (const [id, json] of Object.entries(data)) {
      const user = this.safeJsonParse<User>(json);
      if (user) {
        users[id] = user;
      } else {
        parseErrors++;
      }
    }

    if (parseErrors > 0) {
      this.logger.warn(`Skipped ${parseErrors} users due to JSON parse errors`);
    }

    return users;
  }
}
