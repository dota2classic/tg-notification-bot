import { Logger } from '@nestjs/common';
import { User, UserSettings, DEFAULT_SETTINGS } from '../bot/bot.types';

export abstract class StorageService {
  protected abstract readonly logger: Logger;

  abstract getUser(chatId: string | number): Promise<User | null>;
  abstract setUser(chatId: string | number, user: User): Promise<void>;
  abstract getAllUsers(): Promise<Record<string, User>>;

  async getOrCreateUser(chatId: string | number, username: string): Promise<User> {
    let user = await this.getUser(chatId);
    if (!user) {
      this.logger.debug(`Creating new user: chatId=${chatId}, username=${username}`);
      user = { username, settings: { ...DEFAULT_SETTINGS } };
      await this.setUser(chatId, user);
    } else if (!user.settings) {
      this.logger.debug(`Migrating user settings: chatId=${chatId}`);
      user.settings = { ...DEFAULT_SETTINGS };
      await this.setUser(chatId, user);
    }
    return user;
  }

  async toggleSetting(chatId: string | number, key: keyof UserSettings): Promise<UserSettings | null> {
    const user = await this.getUser(chatId);
    if (!user) {
      this.logger.warn(`toggleSetting called for non-existent user: chatId=${chatId}`);
      return null;
    }

    user.settings = user.settings || { ...DEFAULT_SETTINGS };
    user.settings[key] = !user.settings[key];
    await this.setUser(chatId, user);
    this.logger.debug(`Toggled setting ${key}=${user.settings[key]} for chatId=${chatId}`);
    return user.settings;
  }

  protected safeJsonParse<T>(json: string, fallback: T | null = null): T | null {
    try {
      return JSON.parse(json) as T;
    } catch (err) {
      this.logger.error(`Failed to parse JSON: ${err instanceof Error ? err.message : err}`);
      this.logger.debug(`Malformed JSON: ${json.substring(0, 100)}...`);
      return fallback;
    }
  }
}
