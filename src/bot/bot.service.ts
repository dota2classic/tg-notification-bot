import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Telegraf, Markup, Context } from 'telegraf';
import { Message, Update } from 'telegraf/types';
import { io, Socket } from 'socket.io-client';
import { StorageService } from '../storage/storage.service';
import { UserSettings, QueueState, OnlineStats, DEFAULT_SETTINGS } from './bot.types';

type TextContext = Context<Update.MessageUpdate<Message.TextMessage>>;

const ADMIN_IDS = [389569299, 366409812];
const SOCKET_URL = 'https://api.dotaclassic.ru';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private bot: Telegraf;
  private socket: Socket;

  private queues: Record<number, number> = { 1: 0, 8: 0 };
  private lastPushCount: Record<number, number> = { 1: 0, 8: 0 };

  private readonly queueNotifyThresholds = [8, 9];
  private readonly queueResetThreshold = 5;

  constructor(
    private config: ConfigService,
    private storage: StorageService,
    @InjectPinoLogger(BotService.name) private readonly logger: PinoLogger,
  ) {
    this.bot = new Telegraf(this.config.getOrThrow('TG_KEY'));
  }

  async onModuleInit() {
    this.setupCommands();
    this.setupSocket();

    await this.bot.telegram.setMyCommands([
      { command: 'start', description: 'Начать работу с ботом' },
      { command: 'notifications', description: 'Настройки уведомлений' },
    ]);

    await this.bot.launch();
    this.logger.info('Bot started');
  }

  async onModuleDestroy() {
    this.bot.stop();
    this.socket?.disconnect();
  }

  private setupCommands() {
    this.bot.start((ctx) => this.handleNotifications(ctx, 'start'));
    this.bot.command('notifications', (ctx) => this.handleNotifications(ctx, 'notifications'));

    this.bot.action(/toggle_(normal|highroom|manual)/, async (ctx) => {
      const type = ctx.match[1] as keyof UserSettings;
      const chatId = ctx.chat?.id;
      if (!chatId) {
        this.logger.warn({ event: 'action_no_chat', action: `toggle_${type}` });
        return;
      }

      this.logger.info({
        event: 'action',
        action: `toggle_${type}`,
        userId: ctx.from.id,
        username: ctx.from.username,
        chatId,
      });

      try {
        const settings = await this.storage.toggleSetting(chatId, type);
        if (settings) {
          await ctx.editMessageReplyMarkup(this.getKeyboard(settings).reply_markup);
          await ctx.answerCbQuery('Настройка сохранена');
        } else {
          this.logger.warn({ event: 'toggle_no_user', chatId, type });
          await ctx.answerCbQuery('Ошибка: пользователь не найден');
        }
      } catch (err: unknown) {
        const isMessageNotModified =
          err instanceof Error &&
          'response' in err &&
          (err as { response?: { description?: string } }).response?.description?.includes('message is not modified');

        if (isMessageNotModified) {
          this.logger.debug({ event: 'toggle_no_change', chatId, type });
          await ctx.answerCbQuery('Настройка сохранена');
        } else {
          this.logger.error({ event: 'toggle_error', chatId, type, error: err });
          await ctx.answerCbQuery('Произошла ошибка').catch(() => {});
        }
      }
    });

    this.bot.on('text', async (ctx: TextContext) => {
      const text = ctx.message.text;

      this.logger.info({
        event: 'message',
        text,
        userId: ctx.from.id,
        username: ctx.from.username,
        chatId: ctx.chat.id,
      });

      const lowerText = text.toLowerCase();
      if ((lowerText === 'го' || lowerText === '/го') && ADMIN_IDS.includes(ctx.from.id)) {
        await this.handleManualBroadcast(ctx);
      }
    });
  }

  private async handleManualBroadcast(ctx: TextContext) {
    try {
      const res = await fetch(`${SOCKET_URL}/v1/stats/online`);
      if (!res.ok) {
        this.logger.error({ event: 'api_error', status: res.status, statusText: res.statusText });
        await ctx.reply('Ошибка API: сервер недоступен.');
        return;
      }

      const data = (await res.json()) as OnlineStats;
      const msg = [
        `🚀 *DotaClassic: Пора заходить!*`,
        `👤 Играет: ${data.inGame || 0}`,
        `⚔️ Обычная: ${this.queues[1] || 0}`,
        `🏆 Highroom: ${this.queues[8] || 0}`,
      ].join('\n');

      const result = await this.broadcast(msg, 'manual');
      await ctx.reply(`✅ Рассылка выполнена. Отправлено: ${result.sent}, ошибок: ${result.failed}`);

      this.logger.info({ event: 'broadcast', type: 'manual', triggeredBy: ctx.from.id, ...result });
    } catch (err) {
      this.logger.error({ event: 'broadcast_error', error: err });
      await ctx.reply('Ошибка при выполнении рассылки.');
    }
  }

  private setupSocket() {
    this.socket = io(SOCKET_URL, {
      transports: ['websocket'],
      path: '/socket.io',
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    this.socket.on('connect', () => {
      this.logger.info({ event: 'socket_connected', url: SOCKET_URL });
    });

    this.socket.on('disconnect', (reason) => {
      this.logger.warn({ event: 'socket_disconnected', reason });
    });

    this.socket.on('connect_error', (err) => {
      this.logger.error({ event: 'socket_connect_error', error: err.message });
    });

    this.socket.on('reconnect', (attempt) => {
      this.logger.info({ event: 'socket_reconnected', attempt });
    });

    this.socket.on('reconnect_attempt', (attempt) => {
      this.logger.debug({ event: 'socket_reconnect_attempt', attempt });
    });

    this.socket.on('QUEUE_STATE', async (msg: QueueState) => {
      if (msg?.mode === undefined) {
        this.logger.debug({ event: 'queue_state_invalid', msg });
        return;
      }

      const { mode, inQueue: count } = msg;
      const prev = this.queues[mode] || 0;
      this.queues[mode] = count;

      const shouldNotify =
        this.queueNotifyThresholds.includes(count) && count > prev && this.lastPushCount[mode] !== count;

      if (shouldNotify) {
        this.lastPushCount[mode] = count;
        const type: keyof UserSettings = mode === 1 ? 'normal' : 'highroom';
        const name = mode === 1 ? 'Обычная 5х5' : 'Highroom 5x5';
        const result = await this.broadcast(`🔥 *Почти собрались!* \nВ поиске (${name}) уже *${count}/10* игроков.`, type);

        this.logger.info({ event: 'broadcast', type, mode, count, ...result });
      }

      if (count < this.queueResetThreshold) {
        this.lastPushCount[mode] = 0;
      }
    });
  }

  private async broadcast(text: string, type: keyof UserSettings): Promise<{ sent: number; failed: number }> {
    const users = await this.storage.getAllUsers();
    const keyboard = Markup.inlineKeyboard([[Markup.button.url('🔗 Залететь в поиск', 'https://dotaclassic.ru/queue')]]);

    let sent = 0;
    let failed = 0;

    const sendPromises = Object.entries(users).map(async ([id, user]) => {
      const settings = user.settings || DEFAULT_SETTINGS;
      if (!settings[type]) return;

      try {
        await this.bot.telegram.sendMessage(id, text, { parse_mode: 'Markdown', ...keyboard });
        sent++;
      } catch (err) {
        failed++;
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('blocked') || errorMessage.includes('deactivated')) {
          this.logger.debug({ event: 'broadcast_user_unavailable', userId: id, reason: errorMessage });
        } else {
          this.logger.warn({ event: 'broadcast_send_error', userId: id, error: errorMessage });
        }
      }
    });

    await Promise.all(sendPromises);

    this.logger.info({ event: 'broadcast_complete', type, sent, failed, total: Object.keys(users).length });
    return { sent, failed };
  }

  private async handleNotifications(ctx: Context, command: string) {
    const chatId = ctx.chat?.id;
    const fromId = ctx.from?.id;
    const username = ctx.from?.username;

    if (!chatId || !fromId) {
      this.logger.warn({ event: 'command_no_context', command });
      return;
    }

    this.logger.info({
      event: 'command',
      command,
      userId: fromId,
      username,
      chatId,
    });

    try {
      const user = await this.storage.getOrCreateUser(chatId, username || 'n/a');
      await ctx.reply('⚙️ *Настройки уведомлений*\nВыбери, какие уведомления хочешь получать:', {
        parse_mode: 'Markdown',
        ...this.getKeyboard(user.settings),
      });
    } catch (err) {
      this.logger.error({ event: 'command_error', command, chatId, error: err });
      await ctx.reply('Произошла ошибка. Попробуйте позже.').catch(() => {});
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
