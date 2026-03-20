import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";
import { chatThreads } from "./chat_threads.js";

export const chatCompactionEvents = pgTable("chat_compaction_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  compactedMessageCount: integer("compacted_message_count").notNull(),
  summaryTokenCount: integer("summary_token_count").notNull(),
  tokenCountBefore: integer("token_count_before").notNull(),
  tokenCountAfter: integer("token_count_after").notNull(),
  summaryText: text("summary_text").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
