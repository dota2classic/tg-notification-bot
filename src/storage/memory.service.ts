import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from './storage.service';
import { User } from '../bot/bot.types';

@Injectable()
export class MemoryStorageService extends StorageService {
  private readonly users = new Map<string, User>();
  protected readonly logger = new Logger(MemoryStorageService.name);

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
}
