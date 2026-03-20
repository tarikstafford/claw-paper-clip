import { describe, it, expect, vi, afterEach } from 'vitest';

// Must stub env vars BEFORE importing the module (top-level throw guard)
vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-bot-token');

// Mock global fetch before the module is imported
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Dynamically import after env vars are set
const { formatForTelegramHtml, sendMessage } = await import('../lib/telegram.js');

describe('telegram.ts', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  describe('TELE-05: formatForTelegramHtml', () => {
    it('converts **bold** to <b>bold</b>', () => {
      expect(formatForTelegramHtml('**bold text**')).toBe('<b>bold text</b>');
    });

    it('converts *italic* to <i>italic</i>', () => {
      expect(formatForTelegramHtml('*italic text*')).toBe('<i>italic text</i>');
    });

    it('converts `code` to <code>code</code>', () => {
      expect(formatForTelegramHtml('`some code`')).toBe('<code>some code</code>');
    });

    it('converts ## Heading to <b>Heading</b>', () => {
      expect(formatForTelegramHtml('## My Heading')).toBe('<b>My Heading</b>');
    });

    it('converts # H1 to <b>H1</b>', () => {
      expect(formatForTelegramHtml('# Top Level')).toBe('<b>Top Level</b>');
    });

    it('removes --- horizontal rules', () => {
      const input = 'Above\n---\nBelow';
      const result = formatForTelegramHtml(input);
      expect(result).not.toContain('---');
      expect(result).toContain('Above');
      expect(result).toContain('Below');
    });

    it('handles mixed formatting', () => {
      const input = '## Title\n\n**bold** and *italic*';
      const result = formatForTelegramHtml(input);
      expect(result).toContain('<b>Title</b>');
      expect(result).toContain('<b>bold</b>');
      expect(result).toContain('<i>italic</i>');
    });
  });

  describe('TELE-05: sendMessage', () => {
    it('calls Telegram API with parse_mode: HTML', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"ok":true}',
      });

      await sendMessage(12345, 'Hello world');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/bottest-bot-token/sendMessage');
      const body = JSON.parse(init.body as string);
      expect(body.parse_mode).toBe('HTML');
      expect(body.chat_id).toBe(12345);
      expect(body.text).toBe('Hello world');
    });

    it('retries without parse_mode if Telegram returns "can\'t parse entities"', async () => {
      // First call fails with "can't parse entities"
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Bad Request: can't parse entities: Unsupported start tag",
      });
      // Second call (retry) succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"ok":true}',
      });

      await sendMessage(12345, 'Text with bad <html>');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Second call should NOT have parse_mode
      const [, retryInit] = mockFetch.mock.calls[1] as [string, RequestInit];
      const retryBody = JSON.parse(retryInit.body as string);
      expect(retryBody.parse_mode).toBeUndefined();
      expect(retryBody.text).toBe('Text with bad <html>');
    });
  });
});
