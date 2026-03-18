import { sendMessage } from './lib/telegram.js';
import {
  createConversationIssue,
  postBoardMessage,
  getNewComments,
  CEO_AGENT_ID,
} from './lib/paperclip.js';
import {
  getConversation,
  upsertConversation,
  getAllConversations,
  updateLastSeen,
} from './lib/conversation-store.js';

const POLL_INTERVAL_MS = Number(process.env['POLL_INTERVAL_MS'] ?? 30_000);

// Track forwarded comment IDs to prevent duplicate sends
const forwardedCommentIds = new Set<string>();

/**
 * Converts GitHub-flavored Markdown to Telegram MarkdownV2-safe plain text.
 * Telegram doesn't support ## headings, ---, or nested formatting well,
 * so we convert to a clean readable format.
 */
function formatForTelegram(text: string): string {
  return text
    // Remove horizontal rules
    .replace(/^---+$/gm, '')
    // Convert headings to bold (## Heading → *Heading*)
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    // Convert **bold** to *bold* (Telegram Markdown uses single *)
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    // Remove image syntax ![alt](url)
    .replace(/!\[.*?\]\(.*?\)/g, '')
    // Convert links [text](url) to "text (url)"
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)')
    // Clean up multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Handles an incoming Telegram message from a board member.
 * Creates a Paperclip conversation issue if none exists, then posts the message as a comment.
 */
export async function handleBoardMessage(
  chatId: number,
  username: string,
  text: string,
): Promise<void> {
  try {
    let conversation = getConversation(chatId);

    if (!conversation || !conversation.issueId) {
      // First message (or /new reset) — create a new Paperclip issue for the CEO
      const issueId = await createConversationIssue(chatId, username, text);
      conversation = {
        issueId,
        chatId,
        username,
        lastSeenCommentId: null,
        updatedAt: new Date().toISOString(),
      };
      upsertConversation(conversation);

      await sendMessage(
        chatId,
        `✅ Your message has been forwarded to the CEO. You'll receive a reply here when they respond.`,
      );
      console.log(`[conversation-manager] Created issue ${issueId} for chat ${chatId} (@${username})`);
    } else {
      // Existing conversation — add the message as a comment
      await postBoardMessage(conversation.issueId, username, text);
      console.log(`[conversation-manager] Posted message to issue ${conversation.issueId} for chat ${chatId}`);
    }
  } catch (err) {
    console.error('[conversation-manager] handleBoardMessage error:', (err as Error).message);
    await sendMessage(chatId, '⚠️ Failed to forward your message. Please try again.');
  }
}

/**
 * Polls all active conversation issues for new CEO agent replies
 * and forwards them to the corresponding Telegram chat.
 */
export async function pollCeoReplies(): Promise<void> {
  const conversations = getAllConversations();
  if (conversations.length === 0) return;

  for (const conversation of conversations) {
    try {
      const newComments = await getNewComments(
        conversation.issueId,
        conversation.lastSeenCommentId,
      );

      // Filter to CEO agent comments only (skip board/user comments we posted)
      const ceoComments = newComments.filter(
        (c) => CEO_AGENT_ID && c.authorAgentId === CEO_AGENT_ID,
      );

      for (const comment of ceoComments) {
        if (forwardedCommentIds.has(comment.id)) continue;
        forwardedCommentIds.add(comment.id);
        await sendMessage(conversation.chatId, formatForTelegram(comment.body));
        console.log(`[conversation-manager] Forwarded CEO comment ${comment.id} to chat ${conversation.chatId}`);
      }

      // Update last seen to the latest comment (CEO or not) to avoid re-processing
      const allNew = newComments;
      if (allNew.length > 0) {
        const latest = allNew[allNew.length - 1];
        if (latest) {
          updateLastSeen(conversation.chatId, latest.id);
        }
      }
    } catch (err) {
      console.error(
        `[conversation-manager] Poll error for issue ${conversation.issueId}:`,
        (err as Error).message,
      );
    }
  }
}

/**
 * Starts the background polling loop for CEO replies.
 * Returns a cleanup function.
 */
export function startPoller(): () => void {
  console.log(`[conversation-manager] Starting CEO reply poller (every ${POLL_INTERVAL_MS}ms)`);
  const timer = setInterval(() => {
    pollCeoReplies().catch((err: Error) => {
      console.error('[conversation-manager] Poller error:', err.message);
    });
  }, POLL_INTERVAL_MS);

  return () => clearInterval(timer);
}
