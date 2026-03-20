const TELEGRAM_API = 'https://api.telegram.org';

export const TOKEN = process.env['TELEGRAM_BOT_TOKEN'];

if (!TOKEN) {
  throw new Error('[telegram] TELEGRAM_BOT_TOKEN is not set');
}

/**
 * Converts agent Markdown output to Telegram HTML format.
 */
export function formatForTelegramHtml(text: string): string {
  return text
    // Convert headings (any level) to bold
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    // Convert **bold** to <b>bold</b>
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    // Convert *italic* to <i>italic</i> (after bold to avoid double-processing)
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    // Convert `code` to <code>code</code>
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Remove horizontal rules
    .replace(/^---+$/gm, '')
    // Collapse 3+ newlines to 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function sendMessage(chatId: number | string, text: string): Promise<void> {
  // Try HTML first, fall back to plain text if parsing fails
  let res = await fetch(`${TELEGRAM_API}/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (body.includes("can't parse entities")) {
      // Retry without parse_mode
      res = await fetch(`${TELEGRAM_API}/bot${TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) {
        const retryBody = await res.text();
        console.error('[telegram] sendMessage failed (plain):', res.status, retryBody);
      }
    } else {
      console.error('[telegram] sendMessage failed:', res.status, body);
    }
  }
}

export async function setWebhook(url: string): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}/bot${TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, allowed_updates: ['message'] }),
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) {
    throw new Error(`[telegram] setWebhook failed: ${data.description}`);
  }
  console.log('[telegram] Webhook registered:', url);
}

export interface TelegramEntity {
  offset: number;
  length: number;
  type: string;
  user?: { id: number; username?: string };
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
    entities?: TelegramEntity[];
    reply_to_message?: { from?: { id: number; is_bot?: boolean } };
  };
}
