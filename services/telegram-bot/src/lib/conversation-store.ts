import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const STORE_PATH = process.env['CONVERSATION_STORE_PATH'] ?? '/tmp/telegram-conversations.json';

export interface ConversationEntry {
  threadId: string;
  chatId: number;
  username: string;
  lastSeenMessageId: string | null;
  updatedAt: string;
}

type Store = Record<string, ConversationEntry>; // key = chatId (string)

// Legacy schema shape for migration
interface LegacyConversationEntry {
  issueId?: string;
  threadId?: string;
  chatId: number;
  username: string;
  lastSeenCommentId?: string | null;
  lastSeenMessageId?: string | null;
  updatedAt: string;
}

function load(): Store {
  if (!existsSync(STORE_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf-8')) as Record<string, LegacyConversationEntry>;
    // Migrate old schema: issueId → threadId, lastSeenCommentId → lastSeenMessageId
    const migrated: Store = {};
    for (const [key, entry] of Object.entries(raw)) {
      migrated[key] = {
        threadId: entry.threadId ?? (entry.issueId !== undefined ? '' : ''),
        chatId: entry.chatId,
        username: entry.username,
        lastSeenMessageId: entry.lastSeenMessageId ?? null,
        updatedAt: entry.updatedAt,
      };
    }
    return migrated;
  } catch {
    return {};
  }
}

function save(store: Store): void {
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

export function getConversation(chatId: number): ConversationEntry | null {
  const store = load();
  return store[String(chatId)] ?? null;
}

export function upsertConversation(entry: ConversationEntry): void {
  const store = load();
  store[String(entry.chatId)] = entry;
  save(store);
}

export function getAllConversations(): ConversationEntry[] {
  const store = load();
  return Object.values(store);
}

export function updateLastSeen(chatId: number, lastSeenMessageId: string): void {
  const store = load();
  const entry = store[String(chatId)];
  if (entry) {
    entry.lastSeenMessageId = lastSeenMessageId;
    entry.updatedAt = new Date().toISOString();
    save(store);
  }
}
