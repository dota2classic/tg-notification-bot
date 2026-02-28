import { User, UserSettings } from '../bot/bot.types';

export abstract class StorageService {
  abstract getUser(chatId: string | number): Promise<User | null>;
  abstract setUser(chatId: string | number, user: User): Promise<void>;
  abstract getAllUsers(): Promise<Record<string, User>>;
  abstract getOrCreateUser(chatId: string | number, username: string): Promise<User>;
  abstract toggleSetting(chatId: string | number, key: keyof UserSettings): Promise<UserSettings | null>;
}