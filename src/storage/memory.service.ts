import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from './storage.service';
import { User, UserSettings, DEFAULT_SETTINGS } from '../bot/bot.types';

@Injectable()
export class MemoryStorageService extends StorageService {
  private readonly users = new Map<string, User>();
  private readonly logger = new Logger(MemoryStorageService.name);

  constructor() {
    super();
    this.logger.log('In-memory storage initialized');
  }

  async getUser(chatId: string | number): Promise<User | null> {
    return this.users.get(String(chatId)) || null;
  }

  async setUser(chatId: string | number, user: User): Promise<void> {
    this.users.set(String(chatId), user);
  }

  async getAllUsers(): Promise<Record<string, User>> {
    const result: Record<string, User> = {};
    for (const [id, user] of this.users) {
      result[id] = user;
    }
    return result;
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
