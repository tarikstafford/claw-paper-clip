import { sendMessage, formatForTelegramHtml } from './lib/telegram.js';
import {
  createChatThread,
  postChatMessage,
  getNewMessages,
} from './lib/paperclip.js';
import {
  getConversation,
  upsertConversation,
  getAllConversations,
  updateLastSeen,
} from './lib/conversation-store.js';

const POLL_INTERVAL_MS = Number(process.env['POLL_INTERVAL_MS'] ?? 30_000);

// Track forwarded message IDs to prevent duplicate sends
const forwardedMessageIds = new Set<string>();

/**
 * Handles an incoming Telegram message from a board member.
 * Creates a chat thread if none exists, then posts the message via the chat API.
 */
export async function handleBoardMessage(
  chatId: number,
  username: string,
  text: string,
  telegramUpdateId: number,
): Promise<void> {
  try {
    let conversation = getConversation(chatId);

    if (!conversation || !conversation.threadId) {
      // First message (or /new reset) — create a new chat thread
      const threadId = await createChatThread(chatId, username);
      conversation = {
        threadId,
        chatId,
        username,
        lastSeenMessageId: null,
        updatedAt: new Date().toISOString(),
      };
      upsertConversation(conversation);
      console.log(`[conversation-manager] Created thread ${threadId} for chat ${chatId} (@${username})`);

      // Post the first message to the new thread
      const result = await postChatMessage(threadId, text, telegramUpdateId);
      if (result === 'duplicate') {
        console.log(`[conversation-manager] Duplicate message (updateId=${telegramUpdateId}) ignored for thread ${threadId}`);
      }
    } else {
      // Existing conversation — post to the existing thread
      const result = await postChatMessage(conversation.threadId, text, telegramUpdateId);
      if (result === 'duplicate') {
        console.log(`[conversation-manager] Duplicate message (updateId=${telegramUpdateId}) ignored for thread ${conversation.threadId}`);
        return;
      }
      console.log(`[conversation-manager] Posted message to thread ${conversation.threadId} for chat ${chatId}`);
    }
  } catch (err) {
    console.error('[conversation-manager] handleBoardMessage error:', (err as Error).message);
    await sendMessage(chatId, '⚠️ Failed to forward your message. Please try again.');
  }
}

/**
 * Polls all active conversation threads for new agent replies
 * and forwards them to the corresponding Telegram chat.
 */
export async function pollAgentReplies(): Promise<void> {
  const conversations = getAllConversations();
  if (conversations.length === 0) return;

  for (const conversation of conversations) {
    if (!conversation.threadId) continue;

    try {
      const newMessages = await getNewMessages(
        conversation.threadId,
        conversation.lastSeenMessageId,
      );

      // Filter to agent messages only (skip user messages we posted)
      const agentMessages = newMessages.filter((m) => m.senderType === 'agent');

      for (const msg of agentMessages) {
        if (forwardedMessageIds.has(msg.id)) continue;
        forwardedMessageIds.add(msg.id);
        await sendMessage(conversation.chatId, formatForTelegramHtml(msg.body));
        console.log(`[conversation-manager] Forwarded agent message ${msg.id} to chat ${conversation.chatId}`);
      }

      // Update last seen to the latest message (agent or user) to avoid re-processing
      if (newMessages.length > 0) {
        const latest = newMessages[newMessages.length - 1];
        if (latest) {
          updateLastSeen(conversation.chatId, latest.id);
        }
      }
    } catch (err) {
      console.error(
        `[conversation-manager] Poll error for thread ${conversation.threadId}:`,
        (err as Error).message,
      );
    }
  }
}

/**
 * Starts the background polling loop for agent replies.
 * Returns a cleanup function.
 */
export function startPoller(): () => void {
  console.log(`[conversation-manager] Starting agent reply poller (every ${POLL_INTERVAL_MS}ms)`);
  const timer = setInterval(() => {
    pollAgentReplies().catch((err: Error) => {
      console.error('[conversation-manager] Poller error:', err.message);
    });
  }, POLL_INTERVAL_MS);

  return () => clearInterval(timer);
}
