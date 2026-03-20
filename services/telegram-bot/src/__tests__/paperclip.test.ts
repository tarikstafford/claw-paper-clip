import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

// Must stub env vars BEFORE importing the module (top-level throw guards)
vi.stubEnv('PAPERCLIP_API_URL', 'https://api.example.com');
vi.stubEnv('PAPERCLIP_COMPANY_ID', 'test-company-id');
vi.stubEnv('PAPERCLIP_API_KEY', 'test-api-key');
vi.stubEnv('PAPERCLIP_CEO_AGENT_ID', 'ceo-agent-uuid');

// Mock global fetch before the module is imported
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Dynamically import after env vars are set
const { createChatThread, postChatMessage, getNewMessages } = await import('../lib/paperclip.js');

describe('paperclip.ts', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  describe('TELE-01: createChatThread', () => {
    it('calls POST /api/companies/:companyId/chat/threads with correct body and auth header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'thread-uuid-123' }),
      });

      const threadId = await createChatThread(12345, 'testuser');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.example.com/api/companies/test-company-id/chat/threads');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({ title: 'Telegram: testuser' });
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-api-key');
      expect(threadId).toBe('thread-uuid-123');
    });

    it('throws when server returns non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(createChatThread(12345, 'testuser')).rejects.toThrow('500');
    });
  });

  describe('TELE-01: postChatMessage', () => {
    it('calls POST /api/chat/threads/:threadId/messages with body and telegramUpdateId', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
      });

      const result = await postChatMessage('thread-uuid-123', 'Hello agent!', 99001);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.example.com/api/chat/threads/thread-uuid-123/messages');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({ body: 'Hello agent!', telegramUpdateId: 99001 });
      expect(result).toBe('created');
    });

    it('returns "created" on successful response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
      const result = await postChatMessage('thread-uuid-123', 'test', 1);
      expect(result).toBe('created');
    });
  });

  describe('TELE-01: getNewMessages', () => {
    it('calls GET /api/chat/threads/:threadId/messages with after param when afterMessageId is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [], nextCursor: null }),
      });

      await getNewMessages('thread-uuid-123', 'msg-456');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/api/chat/threads/thread-uuid-123/messages');
      expect(url).toContain('after=msg-456');
    });

    it('calls GET without after param when afterMessageId is null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [], nextCursor: null }),
      });

      await getNewMessages('thread-uuid-123', null);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).not.toContain('after=');
    });

    it('returns the messages array from response', async () => {
      const mockMessages = [
        { id: 'msg-1', threadId: 'thread-uuid-123', senderType: 'agent', body: 'Hello!', createdAt: '2026-01-01T00:00:00Z' },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: mockMessages, nextCursor: null }),
      });

      const messages = await getNewMessages('thread-uuid-123', null);
      expect(messages).toEqual(mockMessages);
    });
  });

  describe('TELE-07: duplicate detection', () => {
    it('returns "duplicate" when fetch returns 409 (does not throw)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
      });

      const result = await postChatMessage('thread-uuid-123', 'Hello', 99001);
      expect(result).toBe('duplicate');
    });

    it('throws on non-409 error (e.g., 500)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(postChatMessage('thread-uuid-123', 'Hello', 99001)).rejects.toThrow('500');
    });
  });
});
