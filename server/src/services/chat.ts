import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { chatMessages, chatThreads } from "@paperclipai/db";
import type { compactionService } from "./compaction.js";

const DEFAULT_TOKEN_COUNT_MODEL = "claude-sonnet-4-5";

export function chatService(db: Db, compactionSvc?: ReturnType<typeof compactionService>) {
  return {
    createThread: async (data: {
      companyId: string;
      agentId: string;
      title: string | null;
      creatorUserId: string | null;
      creatorAgentId: string | null;
    }) => {
      const rows = await db
        .insert(chatThreads)
        .values({
          companyId: data.companyId,
          agentId: data.agentId,
          title: data.title ?? null,
          creatorUserId: data.creatorUserId ?? null,
          creatorAgentId: data.creatorAgentId ?? null,
        })
        .returning();
      return rows[0]!;
    },

    listThreads: async (
      companyId: string,
      filters: {
        agentId?: string;
        creatorUserId?: string;
        creatorAgentId?: string;
      },
    ) => {
      const conditions = [eq(chatThreads.companyId, companyId)];
      if (filters.agentId) {
        conditions.push(eq(chatThreads.agentId, filters.agentId));
      } else if (filters.creatorUserId) {
        conditions.push(eq(chatThreads.creatorUserId, filters.creatorUserId));
      } else if (filters.creatorAgentId) {
        conditions.push(eq(chatThreads.creatorAgentId, filters.creatorAgentId));
      }
      const threads = await db
        .select()
        .from(chatThreads)
        .where(and(...conditions))
        .orderBy(asc(chatThreads.createdAt));

      if (threads.length === 0) return [];

      const threadIds = threads.map((t) => t.id);
      const recentMessages = await db
        .select({
          threadId: chatMessages.threadId,
          body: chatMessages.body,
          senderType: chatMessages.senderType,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(inArray(chatMessages.threadId, threadIds))
        .orderBy(desc(chatMessages.createdAt));

      // Build a map of threadId -> latest message (first seen since results are desc-ordered)
      const lastMessageMap = new Map<string, { body: string; senderType: string; createdAt: Date }>();
      for (const msg of recentMessages) {
        if (!lastMessageMap.has(msg.threadId)) {
          lastMessageMap.set(msg.threadId, {
            body: msg.body,
            senderType: msg.senderType,
            createdAt: msg.createdAt,
          });
        }
      }

      return threads.map((thread) => ({
        ...thread,
        lastMessage: lastMessageMap.get(thread.id) ?? null,
      }));
    },

    getThread: async (threadId: string) => {
      const rows = await db
        .select()
        .from(chatThreads)
        .where(eq(chatThreads.id, threadId));
      return rows[0] ?? undefined;
    },

    createMessage: async (data: {
      threadId: string;
      senderType: string;
      senderUserId: string | null;
      senderAgentId: string | null;
      body: string;
      processingStatus: string;
      telegramUpdateId?: number | null;
    }) => {
      const rows = await db
        .insert(chatMessages)
        .values({
          threadId: data.threadId,
          senderType: data.senderType,
          senderUserId: data.senderUserId ?? null,
          senderAgentId: data.senderAgentId ?? null,
          body: data.body,
          processingStatus: data.processingStatus,
          telegramUpdateId: data.telegramUpdateId ?? null,
        })
        .returning();
      let message = rows[0]!;

      // Count tokens synchronously at write time (COMP-01)
      if (compactionSvc) {
        const tokenCount = await compactionSvc.countMessageTokens(data.body, DEFAULT_TOKEN_COUNT_MODEL);
        if (tokenCount !== null) {
          await db
            .update(chatMessages)
            .set({ tokenCount })
            .where(eq(chatMessages.id, message.id));
          message = { ...message, tokenCount };
        }
      }

      return message;
    },

    listMessages: async (
      threadId: string,
      opts: {
        afterMessageId?: string | null;
        limit: number;
      },
    ) => {
      const conditions = [eq(chatMessages.threadId, threadId)];

      if (opts.afterMessageId) {
        const anchor = await db
          .select({
            id: chatMessages.id,
            createdAt: chatMessages.createdAt,
          })
          .from(chatMessages)
          .where(and(eq(chatMessages.threadId, threadId), eq(chatMessages.id, opts.afterMessageId)))
          .then((rows) => rows[0] ?? null);

        if (!anchor) return [];

        const anchorTs =
          anchor.createdAt instanceof Date ? anchor.createdAt.toISOString() : String(anchor.createdAt);

        conditions.push(
          sql<boolean>`(
            ${chatMessages.createdAt} > ${anchorTs}::timestamptz
            OR (${chatMessages.createdAt} = ${anchorTs}::timestamptz AND ${chatMessages.id} > ${anchor.id})
          )`,
        );
      }

      return db
        .select()
        .from(chatMessages)
        .where(and(...conditions))
        .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
        .limit(opts.limit);
    },
  } as const;
}
