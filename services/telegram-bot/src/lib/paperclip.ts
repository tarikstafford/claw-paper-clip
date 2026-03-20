const API_URL = process.env['PAPERCLIP_API_URL'];
const COMPANY_ID = process.env['PAPERCLIP_COMPANY_ID'];
const API_KEY = process.env['PAPERCLIP_API_KEY'];
export const CEO_AGENT_ID = process.env['PAPERCLIP_CEO_AGENT_ID'];

if (!API_URL || !COMPANY_ID || !API_KEY) {
  throw new Error('[paperclip] Missing PAPERCLIP_API_URL, PAPERCLIP_COMPANY_ID, or PAPERCLIP_API_KEY');
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderType: string;
  body: string;
  createdAt: string;
}

async function chatFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

/**
 * Creates a new chat thread for a Telegram conversation.
 * Returns the thread ID.
 */
export async function createChatThread(chatId: number, username: string): Promise<string> {
  const res = await chatFetch(`/api/companies/${COMPANY_ID}/chat/threads`, {
    method: 'POST',
    body: JSON.stringify({
      agentId: CEO_AGENT_ID,
      title: `Telegram: ${username}`,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[paperclip] createChatThread → ${res.status}: ${body}`);
  }
  const thread = (await res.json()) as { id: string };
  return thread.id;
}

/**
 * Posts a message to a chat thread.
 * Returns 'created' on success, 'duplicate' if telegramUpdateId already exists (409).
 */
export async function postChatMessage(
  threadId: string,
  body: string,
  telegramUpdateId: number,
): Promise<'created' | 'duplicate'> {
  const res = await chatFetch(`/api/chat/threads/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body, telegramUpdateId }),
  });
  if (res.status === 409) {
    return 'duplicate';
  }
  if (!res.ok) {
    const resBody = await res.text();
    throw new Error(`[paperclip] postChatMessage → ${res.status}: ${resBody}`);
  }
  return 'created';
}

/**
 * Fetches new messages from a chat thread after a given message ID.
 * Returns messages in ascending order.
 */
export async function getNewMessages(
  threadId: string,
  afterMessageId: string | null,
): Promise<ChatMessage[]> {
  const url = afterMessageId
    ? `/api/chat/threads/${threadId}/messages?after=${afterMessageId}&limit=50`
    : `/api/chat/threads/${threadId}/messages?limit=50`;

  const res = await chatFetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[paperclip] getNewMessages → ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { messages: ChatMessage[]; nextCursor: string | null };
  return data.messages;
}
