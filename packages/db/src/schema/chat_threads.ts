import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    creatorAgentId: uuid("creator_agent_id").references(() => agents.id),
    creatorUserId: text("creator_user_id"),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyAgentIdx: index("chat_threads_company_agent_idx").on(table.companyId, table.agentId),
    companyCreatedAtIdx: index("chat_threads_company_created_at_idx").on(table.companyId, table.createdAt),
  }),
);
