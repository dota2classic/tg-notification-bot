import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { StorageService } from '../storage/storage.service';
import { User, UserSettings, DEFAULT_SETTINGS } from '../bot/bot.types';

const USERS_KEY = 'tg_bot:users';

@Injectable()
export class RedisService extends StorageService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private readonly logger = new Logger(RedisService.name);

  constructor(private config: ConfigService) {
    super();
  }

  async onModuleInit() {
    this.client = createClient({
      socket: {
        host: this.config.get('REDIS_HOST', 'localhost'),
        port: 6379,
      },
      password: this.config.get('REDIS_PASSWORD'),
    });

    this.client.on('error', (err) => this.logger.error('Redis error', err));
    await this.client.connect();
    this.logger.log('Connected to Redis');
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async getUser(chatId: string | number): Promise<User | null> {
    const data = await this.client.hGet(USERS_KEY, String(chatId));
    return data ? JSON.parse(data) : null;
  }

  async setUser(chatId: string | number, user: User): Promise<void> {
    await this.client.hSet(USERS_KEY, String(chatId), JSON.stringify(user));
  }

  async getAllUsers(): Promise<Record<string, User>> {
    const data = await this.client.hGetAll(USERS_KEY);
    const users: Record<string, User> = {};
    for (const [id, json] of Object.entries(data)) {
      users[id] = JSON.parse(json);
    }
    return users;
  }

  async getOrCreateUser(chatId: string | number, username: string): Promise<User> {
    let user = await this.getUser(chatId);
    if (!user) {
      user = { username, settings: { ...DEFAULT_SETTINGS } };
      await this.setUser(chatId, user);
    } else if (!user.settings) {
      user.settings = { ...DEFAULT_SETTINGS };
      await this.setUser(chatId, user);
    }
    return user;
  }

  async toggleSetting(chatId: string | number, key: keyof UserSettings): Promise<UserSettings | null> {
    const user = await this.getUser(chatId);
    if (!user) return null;

    user.settings = user.settings || { ...DEFAULT_SETTINGS };
    user.settings[key] = !user.settings[key];
    await this.setUser(chatId, user);
    return user.settings;
  }
}
