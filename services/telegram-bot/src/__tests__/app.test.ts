import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock global fetch before any module is loaded (app.ts calls fetch at module level)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock modules before importing app
vi.mock('../conversation-manager.js', () => ({
  handleBoardMessage: vi.fn(),
  pollAgentReplies: vi.fn(),
  startPoller: vi.fn(),
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

import { buildApp } from '../app.js';
import { handleBoardMessage } from '../conversation-manager.js';
import { sendMessage } from '../lib/telegram.js';
import { getConversation, upsertConversation } from '../lib/conversation-store.js';

const mockHandleBoardMessage = vi.mocked(handleBoardMessage);
const mockSendMessage = vi.mocked(sendMessage);
const mockGetConversation = vi.mocked(getConversation);
const mockUpsertConversation = vi.mocked(upsertConversation);

describe('app.ts', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: getMe resolves cleanly so module-level fetch doesn't throw
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { username: 'TestBot' } }),
    });
    app = buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('TELE-02: immediate 200 response', () => {
    it('returns 200 immediately without awaiting handleBoardMessage', async () => {
      // handleBoardMessage returns a promise that never resolves
      let resolveHbm!: () => void;
      const neverResolves = new Promise<void>((resolve) => {
        resolveHbm = resolve;
      });
      mockHandleBoardMessage.mockReturnValue(neverResolves);
      mockGetConversation.mockReturnValue({
        threadId: 'existing-thread',
        chatId: 12345,
        username: 'testuser',
        lastSeenMessageId: null,
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/webhook',
        payload: {
          update_id: 99001,
          message: {
            message_id: 1,
            chat: { id: 12345, type: 'private' },
            from: { id: 54321, username: 'testuser', first_name: 'Test' },
            text: 'Hello agent!',
          },
        },
      });

      // Response came back immediately (200) while handleBoardMessage is still pending
      expect(response.statusCode).toBe(200);
      expect(mockHandleBoardMessage).toHaveBeenCalledOnce();

      // Cleanup the dangling promise
      resolveHbm();
    });

    it('calls handleBoardMessage with correct arguments', async () => {
      mockHandleBoardMessage.mockResolvedValue(undefined);

      await app.inject({
        method: 'POST',
        url: '/webhook',
        payload: {
          update_id: 99002,
          message: {
            message_id: 2,
            chat: { id: 12345, type: 'private' },
            from: { id: 54321, username: 'alice', first_name: 'Alice' },
            text: 'Tell me about the quarterly results',
          },
        },
      });

      expect(mockHandleBoardMessage).toHaveBeenCalledWith(
        12345,
        'alice',
        'Tell me about the quarterly results',
        99002
      );
    });
  });

  describe('TELE-04: /new command clears threadId', () => {
    it('calls upsertConversation with threadId empty string and lastSeenMessageId null', async () => {
      const existingConversation = {
        threadId: 'existing-thread-uuid',
        chatId: 12345,
        username: 'testuser',
        lastSeenMessageId: 'msg-100',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      mockGetConversation.mockReturnValue(existingConversation);
      mockSendMessage.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/webhook',
        payload: {
          update_id: 99003,
          message: {
            message_id: 3,
            chat: { id: 12345, type: 'private' },
            from: { id: 54321, username: 'testuser' },
            text: '/new',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockUpsertConversation).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: '', lastSeenMessageId: null })
      );
    });

    it('does not call upsertConversation when no existing conversation for /new', async () => {
      mockGetConversation.mockReturnValue(null);
      mockSendMessage.mockResolvedValue(undefined);

      await app.inject({
        method: 'POST',
        url: '/webhook',
        payload: {
          update_id: 99004,
          message: {
            message_id: 4,
            chat: { id: 12345, type: 'private' },
            from: { id: 54321, username: 'testuser' },
            text: '/new',
          },
        },
      });

      expect(mockUpsertConversation).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('returns 200 when message has no text', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook',
        payload: {
          update_id: 99005,
          message: {
            message_id: 5,
            chat: { id: 12345, type: 'private' },
            from: { id: 54321, username: 'testuser' },
            // no text
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockHandleBoardMessage).not.toHaveBeenCalled();
    });

    it('returns 200 for /help command and calls sendMessage with help text', async () => {
      mockSendMessage.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/webhook',
        payload: {
          update_id: 99006,
          message: {
            message_id: 6,
            chat: { id: 12345, type: 'private' },
            from: { id: 54321, username: 'testuser' },
            text: '/help',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockHandleBoardMessage).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledOnce();
      const [, helpText] = mockSendMessage.mock.calls[0] as [number, string];
      expect(helpText).toContain('/help');
    });
  });
});
