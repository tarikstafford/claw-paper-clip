CREATE TABLE IF NOT EXISTS "chat_compaction_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL REFERENCES "chat_threads"("id") ON DELETE CASCADE,
  "compacted_message_count" integer NOT NULL,
  "summary_token_count" integer NOT NULL,
  "token_count_before" integer NOT NULL,
  "token_count_after" integer NOT NULL,
  "summary_text" text NOT NULL,
  "model" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
