import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup } from 'telegraf';
import { io, Socket } from 'socket.io-client';
import { RedisService } from '../redis/redis.service';
import { UserSettings, QueueState, OnlineStats, DEFAULT_SETTINGS } from './bot.types';

const ADMIN_ID = 389569299;
const SOCKET_URL = 'https://api.dotaclassic.ru';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private bot: Telegraf;
  private socket: Socket;
  private readonly logger = new Logger(BotService.name);

  private queues: Record<number, number> = { 1: 0, 8: 0 };
  private lastPushCount: Record<number, number> = { 1: 0, 8: 0 };

  constructor(
    private config: ConfigService,
    private redis: RedisService,
  ) {
    this.bot = new Telegraf(this.config.getOrThrow('TG_KEY'));
  }

  async onModuleInit() {
    this.setupCommands();
    this.setupSocket();
    await this.bot.launch();
    this.logger.log('Bot started');
  }

  async onModuleDestroy() {
    this.bot.stop();
    this.socket?.disconnect();
  }

  private setupCommands() {
    this.bot.start(async (ctx) => {
      const user = await this.redis.getOrCreateUser(ctx.chat.id, ctx.from.username || 'n/a');
      await ctx.reply('⚙️ *Настройки уведомлений*\nВыбери, какие уведомления хочешь получать:', {
        parse_mode: 'Markdown',
        ...this.getKeyboard(user.settings),
      });
    });

    this.bot.action(/toggle_(normal|highroom|manual)/, async (ctx) => {
      const type = ctx.match[1] as keyof UserSettings;
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      const settings = await this.redis.toggleSetting(chatId, type);
      if (settings) {
        await ctx.editMessageReplyMarkup(this.getKeyboard(settings).reply_markup);
        await ctx.answerCbQuery('Настройка сохранена');
      }
    });

    this.bot.on('text', async (ctx) => {
      const text = ctx.message.text.toLowerCase();
      if ((text === 'го' || text === '/го') && ctx.from.id === ADMIN_ID) {
        try {
          const res = await fetch(`${SOCKET_URL}/v1/stats/online`);
          const data = (await res.json()) as OnlineStats;
          const msg = [
            `🚀 *DotaClassic: Пора заходить!*`,
            `👤 Онлайн: ${data.sessions || 0}`,
            `⚔️ Обычная: ${this.queues[1] || 0}`,
            `🏆 Highroom: ${this.queues[8] || 0}`,
          ].join('\n');
          await this.broadcast(msg, 'manual');
          await ctx.reply('✅ Рассылка выполнена.');
        } catch {
          await ctx.reply('Ошибка API.');
        }
      }
    });
  }

  private setupSocket() {
    this.socket = io(SOCKET_URL, { transports: ['websocket'], path: '/socket.io' });

    this.socket.on('QUEUE_STATE', async (msg: QueueState) => {
      if (msg?.mode === undefined) return;

      const { mode, inQueue: count } = msg;
      const prev = this.queues[mode] || 0;
      this.queues[mode] = count;

      if ((count === 8 || count === 9) && count > prev && this.lastPushCount[mode] !== count) {
        this.lastPushCount[mode] = count;
        const type: keyof UserSettings = mode === 1 ? 'normal' : 'highroom';
        const name = mode === 1 ? 'Обычная 5х5' : 'Highroom 5x5';
        await this.broadcast(`🔥 *Почти собрались!* \nВ поиске (${name}) уже *${count}/10* игроков.`, type);
      }

      if (count < 5) this.lastPushCount[mode] = 0;
    });
  }

  private async broadcast(text: string, type: keyof UserSettings) {
    const users = await this.redis.getAllUsers();
    const keyboard = Markup.inlineKeyboard([[Markup.button.url('🔗 Залететь в поиск', 'https://dotaclassic.ru')]]);

    for (const [id, user] of Object.entries(users)) {
      const settings = user.settings || DEFAULT_SETTINGS;
      if (settings[type]) {
        this.bot.telegram.sendMessage(id, text, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
      }
    }
  }

  private getKeyboard(settings?: UserSettings) {
    const s = settings || DEFAULT_SETTINGS;
    return Markup.inlineKeyboard([
      [Markup.button.callback(`${s.normal ? '✅' : '❌'} Обычная 5х5 (Авто)`, 'toggle_normal')],
      [Markup.button.callback(`${s.highroom ? '✅' : '❌'} Highroom 5х5 (Авто)`, 'toggle_highroom')],
      [Markup.button.callback(`${s.manual ? '✅' : '❌'} Рассылки админа (ГО)`, 'toggle_manual')],
      [Markup.button.url('🔗 На сайт', 'https://dotaclassic.ru')],
    ]);
  }
}
