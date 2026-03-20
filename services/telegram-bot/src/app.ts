import Fastify from 'fastify';
import { sendMessage, TOKEN, type TelegramUpdate } from './lib/telegram.js';
import { handleBoardMessage } from './conversation-manager.js';
import { getConversation, upsertConversation } from './lib/conversation-store.js';

// Resolve bot username on startup
let BOT_USERNAME = '';
fetch(`https://api.telegram.org/bot${TOKEN}/getMe`)
  .then(r => r.json() as Promise<{ ok: boolean; result: { username: string } }>)
  .then(data => {
    if (data.ok) {
      BOT_USERNAME = data.result.username.toLowerCase();
      console.log(`[app] Bot username resolved: @${BOT_USERNAME}`);
    }
  })
  .catch(() => {});

function isBotMentioned(update: TelegramUpdate): boolean {
  const message = update.message;
  if (!message) return false;

  // DMs always count
  if (message.chat.type === 'private') return true;

  // Check @mention entities
  if (message.entities && BOT_USERNAME) {
    for (const entity of message.entities) {
      if (entity.type === 'mention' && message.text) {
        const mention = message.text.substring(entity.offset, entity.offset + entity.length).toLowerCase();
        if (mention === `@${BOT_USERNAME}`) return true;
      }
    }
  }

  // Check if replying to the bot's message
  if (message.reply_to_message?.from?.is_bot) return true;

  return false;
}

const HELP_TEXT = [
  '*Akasa Board Bot*',
  '',
  'This bot connects you directly to the Akasa CEO.',
  '',
  'Just send any message and it will be forwarded to the CEO.',
  'You\'ll receive their reply here when they respond.',
  '',
  '/help — Show this message',
  '/new  — Start a fresh conversation thread',
].join('\n');

// Comma-separated list of allowed Telegram user IDs (optional — if empty, all users allowed)
const ALLOWED_USER_IDS = new Set(
  (process.env['ALLOWED_TELEGRAM_USER_IDS'] ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
);

function isAuthorized(userId: number | undefined): boolean {
  if (ALLOWED_USER_IDS.size === 0) return true; // no allowlist = open
  return userId !== undefined && ALLOWED_USER_IDS.has(userId);
}

export function buildApp() {
  const app = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  });

  // Health check
  app.get('/health', async () => ({ ok: true }));

  // Telegram webhook receiver
  app.post('/webhook', async (request, reply) => {
    const update = request.body as TelegramUpdate;
    const message = update.message;

    if (!message?.text) {
      return reply.code(200).send({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text.trim();
    const userId = message.from?.id;
    const username = message.from?.username ?? message.from?.first_name ?? String(userId ?? chatId);

    if (!isAuthorized(userId)) {
      console.warn(`[app] Unauthorized user ${userId} (@${username}) in chat ${chatId}`);
      sendMessage(chatId, '⛔ You are not authorized to use this bot.').catch(() => {});
      return reply.code(200).send({ ok: true });
    }

    // In groups, only respond to messages that @mention the bot or reply to it
    if (message.chat.type !== 'private' && !isBotMentioned(update)) {
      return reply.code(200).send({ ok: true });
    }

    // Strip the @bot mention from the text so the CEO gets a clean message
    const cleanText = BOT_USERNAME
      ? text.replace(new RegExp(`@${BOT_USERNAME}`, 'gi'), '').trim()
      : text;

    // Strip bot username suffix (e.g. /help@MyBot → /help)
    const command = text.split('@')[0]?.split(' ')[0]?.toLowerCase() ?? '';

    if (command === '/help' || command === '/start') {
      sendMessage(chatId, HELP_TEXT).catch((err: Error) =>
        console.error('[app] sendMessage error:', err.message),
      );
      return reply.code(200).send({ ok: true });
    }

    if (command === '/new') {
      // Reset this chat's conversation so the next message creates a fresh thread
      const existing = getConversation(chatId);
      if (existing) {
        upsertConversation({ ...existing, threadId: '', lastSeenMessageId: null, updatedAt: new Date().toISOString() });
      }
      sendMessage(chatId, '🔄 Starting a new conversation thread. Send your message!').catch(
        (err: Error) => console.error('[app] sendMessage error:', err.message),
      );
      return reply.code(200).send({ ok: true });
    }

    // Any other message — forward to CEO via chat API (fire-and-forget)
    handleBoardMessage(chatId, username, cleanText || text, update.update_id).catch((err: Error) => {
      console.error('[app] handleBoardMessage error:', err.message);
    });

    return reply.code(200).send({ ok: true });
  });

  return app;
}
