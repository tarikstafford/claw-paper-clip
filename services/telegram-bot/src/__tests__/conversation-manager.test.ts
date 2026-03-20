import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing conversation-manager
vi.mock('../lib/paperclip.js', () => ({
  createChatThread: vi.fn(),
  postChatMessage: vi.fn(),
  getNewMessages: vi.fn(),
  CEO_AGENT_ID: 'ceo-agent-uuid',
}));

vi.mock('../lib/telegram.js', () => ({
  sendMessage: vi.fn(),
  formatForTelegramHtml: vi.fn((text: string) => text),
  TOKEN: 'mock-token',
}));

vi.mock('../lib/conversation-store.js', () => ({
  getConversation: vi.fn(),
  upsertConversation: vi.fn(),
  getAllConversations: vi.fn(),
  updateLastSeen: vi.fn(),
}));

import {
  handleBoardMessage,
  pollAgentReplies,
} from '../conversation-manager.js';
import {
  createChatThread,
  postChatMessage,
  getNewMessages,
} from '../lib/paperclip.js';
import { sendMessage } from '../lib/telegram.js';
import {
  getConversation,
  upsertConversation,
  getAllConversations,
  updateLastSeen,
} from '../lib/conversation-store.js';

const mockCreateChatThread = vi.mocked(createChatThread);
const mockPostChatMessage = vi.mocked(postChatMessage);
const mockGetNewMessages = vi.mocked(getNewMessages);
const mockSendMessage = vi.mocked(sendMessage);
const mockGetConversation = vi.mocked(getConversation);
const mockUpsertConversation = vi.mocked(upsertConversation);
const mockGetAllConversations = vi.mocked(getAllConversations);
const mockUpdateLastSeen = vi.mocked(updateLastSeen);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('conversation-manager.ts', () => {
  describe('TELE-03: auto-create thread', () => {
    it('creates a new thread when getConversation returns null', async () => {
      mockGetConversation.mockReturnValue(null);
      mockCreateChatThread.mockResolvedValue('new-thread-uuid');
      mockPostChatMessage.mockResolvedValue('created');

      await handleBoardMessage(12345, 'testuser', 'Hello!', 99001);

      expect(mockCreateChatThread).toHaveBeenCalledOnce();
      expect(mockCreateChatThread).toHaveBeenCalledWith(12345, 'testuser');
      expect(mockPostChatMessage).toHaveBeenCalledWith('new-thread-uuid', 'Hello!', 99001);
      expect(mockUpsertConversation).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: 'new-thread-uuid', chatId: 12345, username: 'testuser' })
      );
    });

    it('does NOT call createChatThread when conversation with threadId already exists', async () => {
      mockGetConversation.mockReturnValue({
        threadId: 'existing-thread-uuid',
        chatId: 12345,
        username: 'testuser',
        lastSeenMessageId: null,
        updatedAt: '2026-01-01T00:00:00Z',
      });
      mockPostChatMessage.mockResolvedValue('created');

      await handleBoardMessage(12345, 'testuser', 'Hello again!', 99002);

      expect(mockCreateChatThread).not.toHaveBeenCalled();
      expect(mockPostChatMessage).toHaveBeenCalledWith('existing-thread-uuid', 'Hello again!', 99002);
    });

    it('creates a new thread when existing conversation has empty threadId', async () => {
      mockGetConversation.mockReturnValue({
        threadId: '', // empty = was reset by /new
        chatId: 12345,
        username: 'testuser',
        lastSeenMessageId: null,
        updatedAt: '2026-01-01T00:00:00Z',
      });
      mockCreateChatThread.mockResolvedValue('fresh-thread-uuid');
      mockPostChatMessage.mockResolvedValue('created');

      await handleBoardMessage(12345, 'testuser', 'Fresh start!', 99003);

      expect(mockCreateChatThread).toHaveBeenCalledOnce();
      expect(mockUpsertConversation).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: 'fresh-thread-uuid' })
      );
    });
  });

  describe('TELE-06: agent reply forwarding', () => {
    it('calls getNewMessages for each conversation with a threadId', async () => {
      mockGetAllConversations.mockReturnValue([
        {
          threadId: 'thread-1',
          chatId: 11111,
          username: 'user1',
          lastSeenMessageId: 'msg-old',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          threadId: 'thread-2',
          chatId: 22222,
          username: 'user2',
          lastSeenMessageId: null,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);
      mockGetNewMessages.mockResolvedValue([]);

      await pollAgentReplies();

      expect(mockGetNewMessages).toHaveBeenCalledTimes(2);
      expect(mockGetNewMessages).toHaveBeenCalledWith('thread-1', 'msg-old');
      expect(mockGetNewMessages).toHaveBeenCalledWith('thread-2', null);
    });

    it('forwards agent messages to Telegram via sendMessage', async () => {
      mockGetAllConversations.mockReturnValue([
        {
          threadId: 'thread-1',
          chatId: 11111,
          username: 'user1',
          lastSeenMessageId: null,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);
      mockGetNewMessages.mockResolvedValue([
        {
          id: 'msg-agent-1',
          threadId: 'thread-1',
          senderType: 'agent',
          body: 'Agent response here',
          createdAt: '2026-01-01T00:00:01Z',
        },
      ]);

      await pollAgentReplies();

      expect(mockSendMessage).toHaveBeenCalledOnce();
      expect(mockSendMessage).toHaveBeenCalledWith(11111, expect.any(String));
    });

    it('does NOT forward user messages (senderType === "user")', async () => {
      mockGetAllConversations.mockReturnValue([
        {
          threadId: 'thread-1',
          chatId: 11111,
          username: 'user1',
          lastSeenMessageId: null,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);
      mockGetNewMessages.mockResolvedValue([
        {
          id: 'msg-user-1',
          threadId: 'thread-1',
          senderType: 'user',
          body: 'User message that was echoed back',
          createdAt: '2026-01-01T00:00:01Z',
        },
      ]);

      await pollAgentReplies();

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('calls updateLastSeen with the latest message id', async () => {
      mockGetAllConversations.mockReturnValue([
        {
          threadId: 'thread-1',
          chatId: 11111,
          username: 'user1',
          lastSeenMessageId: null,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);
      mockGetNewMessages.mockResolvedValue([
        {
          id: 'msg-1',
          threadId: 'thread-1',
          senderType: 'user',
          body: 'msg 1',
          createdAt: '2026-01-01T00:00:01Z',
        },
        {
          id: 'msg-2',
          threadId: 'thread-1',
          senderType: 'agent',
          body: 'response',
          createdAt: '2026-01-01T00:00:02Z',
        },
      ]);

      await pollAgentReplies();

      expect(mockUpdateLastSeen).toHaveBeenCalledWith(11111, 'msg-2');
    });

    it('skips conversations without threadId', async () => {
      mockGetAllConversations.mockReturnValue([
        {
          threadId: '', // no thread
          chatId: 11111,
          username: 'user1',
          lastSeenMessageId: null,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);

      await pollAgentReplies();

      expect(mockGetNewMessages).not.toHaveBeenCalled();
    });
  });
});
