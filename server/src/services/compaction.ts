import { asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { chatMessages, chatCompactionEvents } from "@paperclipai/db";
import type Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-5": 200_000,
  "claude-sonnet-4-5": 200_000,
  "claude-haiku-3-5": 200_000,
  "MiniMax-M2.7": 204_800,
  "MiniMax-M2.7-highspeed": 204_800,
};
const DEFAULT_CONTEXT_WINDOW = 200_000;
const COMPACTION_THRESHOLD_RATIO = 0.55;
const DEFAULT_VERBATIM_TURNS = 20;
const SUMMARIZATION_MODEL = "claude-haiku-3-5";

const SUMMARIZE_SYSTEM = `You are summarizing a conversation between a user and an AI agent.
Produce a concise structured summary that preserves:
- Key decisions made
- Questions asked and their answers
- Action items or tasks discussed
- Important context the agent needs to continue

Be factual. Do not add information not present in the messages.
Format: plain prose paragraphs, no headers needed.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getContextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}

type DbMessage = {
  id: string;
  senderType: string;
  body: string;
  tokenCount: number | null;
  createdAt: Date;
};

function estimateTokens(body: string): number {
  return Math.ceil(body.length / 4);
}

function resolveTokenCount(msg: DbMessage): number {
  return msg.tokenCount ?? estimateTokens(msg.body);
}

function formatMessages(messages: DbMessage[]): string {
  return messages.map((m) => `[${m.senderType}]: ${m.body}`).join("\n");
}

/**
 * Map DB messages to Anthropic alternating-role format.
 * Consecutive same-role messages are merged by concatenating content.
 */
function toAnthropicMessages(messages: DbMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    const role: "user" | "assistant" = msg.senderType === "agent" ? "assistant" : "user";
    const last = result[result.length - 1];

    if (last && last.role === role) {
      // Merge by concatenating text content
      if (typeof last.content === "string") {
        last.content = last.content + "\n" + msg.body;
      } else {
        // Content is an array — append a new text block
        (last.content as Anthropic.TextBlockParam[]).push({ type: "text", text: msg.body });
      }
    } else {
      result.push({ role, content: msg.body });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function compactionService(db: Db, anthropicClient: Anthropic) {
  /**
   * Count tokens in a message body using the Anthropic token counting API.
   * Returns null on failure — token counting is best-effort.
   */
  async function countMessageTokens(body: string, model: string): Promise<number | null> {
    try {
      const result = await anthropicClient.messages.countTokens({
        model,
        messages: [{ role: "user", content: body }],
      });
      return result.input_tokens;
    } catch (err) {
      console.error("[compactionService] countMessageTokens failed:", err);
      return null;
    }
  }

  /**
   * Summarize a set of messages via the Anthropic Messages API.
   */
  async function summarizeMessages(messages: DbMessage[]): Promise<string> {
    const anthropicMessages = toAnthropicMessages(messages);
    const response = await anthropicClient.messages.create({
      model: SUMMARIZATION_MODEL,
      max_tokens: 1024,
      system: SUMMARIZE_SYSTEM,
      messages: anthropicMessages,
    });
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("[compactionService] summarizeMessages: no text block in response");
    }
    return textBlock.text;
  }

  /**
   * Build a prompt for the thread, applying compaction if the token budget
   * exceeds 55% of the model context window.
   *
   * IMPORTANT: Stored messages are never modified or deleted. Compaction is
   * a read-time prompt construction step only.
   */
  async function buildThreadPrompt(
    threadId: string,
    model: string,
  ): Promise<{ prompt: string; wasCompacted: boolean; tokensBefore: number; tokensAfter: number }> {
    // Load all messages ordered by creation time (ascending)
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.createdAt));

    // Sum token counts (use character estimate for nulls)
    const totalTokens = messages.reduce((sum, m) => sum + resolveTokenCount(m), 0);

    const threshold = Math.floor(getContextWindow(model) * COMPACTION_THRESHOLD_RATIO);

    // Below threshold — return verbatim prompt
    if (totalTokens < threshold) {
      return {
        prompt: formatMessages(messages),
        wasCompacted: false,
        tokensBefore: totalTokens,
        tokensAfter: totalTokens,
      };
    }

    // Not enough messages to compact
    if (messages.length <= DEFAULT_VERBATIM_TURNS) {
      return {
        prompt: formatMessages(messages),
        wasCompacted: false,
        tokensBefore: totalTokens,
        tokensAfter: totalTokens,
      };
    }

    // Split into messages to summarize and verbatim tail
    const splitIndex = messages.length - DEFAULT_VERBATIM_TURNS;
    const toSummarize = messages.slice(0, splitIndex);
    const verbatim = messages.slice(splitIndex);

    // Summarize older messages
    const summaryText = await summarizeMessages(toSummarize);

    // Count tokens for summary + verbatim tail
    const summaryTokenCount = (await countMessageTokens(summaryText, model)) ?? estimateTokens(summaryText);
    const verbatimTokens = verbatim.reduce((sum, m) => sum + resolveTokenCount(m), 0);
    const tokensAfter = summaryTokenCount + verbatimTokens;

    // Record compaction audit event
    await db.insert(chatCompactionEvents).values({
      threadId,
      compactedMessageCount: toSummarize.length,
      summaryTokenCount,
      tokenCountBefore: totalTokens,
      tokenCountAfter: tokensAfter,
      summaryText,
      model,
    });

    // Format final prompt
    const verbatimFormatted = formatMessages(verbatim);
    const prompt =
      `<conversation_summary>\n${summaryText}\n</conversation_summary>\n\n` +
      `<recent_messages>\n${verbatimFormatted}\n</recent_messages>`;

    return { prompt, wasCompacted: true, tokensBefore: totalTokens, tokensAfter };
  }

  return {
    countMessageTokens,
    buildThreadPrompt,
  } as const;
}
