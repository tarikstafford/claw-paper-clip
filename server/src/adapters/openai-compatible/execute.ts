import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import { asString, asNumber, buildPaperclipEnv } from "../utils.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { config, runId, agent, context, onLog, onMeta } = ctx;

  // Config fields
  const baseUrl = asString(config.baseUrl, "https://api.minimax.io/v1");
  const apiKey = asString(config.apiKey, "") || process.env.MINIMAX_API_KEY || process.env.OPENAI_COMPATIBLE_API_KEY || "";
  const model = asString(config.model, "MiniMax-M2.7");
  const maxTokens = asNumber(config.maxTokens, 4096);
  const temperature = asNumber(config.temperature, 0.7);
  const timeoutMs = asNumber(config.timeoutMs, 120_000);

  if (!apiKey) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "No API key configured. Set apiKey in adapter config or OPENAI_COMPATIBLE_API_KEY env var.",
      errorCode: "missing_api_key",
    };
  }

  // Build the prompt from context (same shape as other adapters)
  const systemPrompt = asString(config.systemPrompt, `You are agent ${agent.id} (${agent.name}). You work for a company managed by the Paperclip platform.`);
  const chatThreadContext = asString(context.paperclipChatThreadContext, "");
  const wakeReason = asString(context.wakeReason, "");

  // Build messages array
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  // If this is a chat message wake, parse the thread context into messages
  if (wakeReason === "chat_message" && chatThreadContext) {
    const lines = chatThreadContext.split("\n");
    for (const line of lines) {
      const userMatch = line.match(/^\[user\]:\s*(.+)$/);
      const agentMatch = line.match(/^\[agent\]:\s*(.+)$/);
      if (userMatch) {
        messages.push({ role: "user", content: userMatch[1] });
      } else if (agentMatch) {
        messages.push({ role: "assistant", content: agentMatch[1] });
      } else if (line.trim()) {
        // Treat untagged lines as user messages
        messages.push({ role: "user", content: line.trim() });
      }
    }
  } else {
    // Non-chat wake — use the rendered prompt as a user message
    const prompt = asString(context.prompt, `Continue your work as ${agent.name}.`);
    messages.push({ role: "user", content: prompt });
  }

  // Emit invocation metadata
  await onMeta?.({
    adapterType: "openai_compatible",
    command: `POST ${baseUrl}/chat/completions`,
    prompt: messages.map((m) => `[${m.role}]: ${m.content}`).join("\n"),
    context,
  });

  await onLog("stderr", `[openai-compatible] Calling ${baseUrl}/chat/completions (model: ${model})\n`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      await onLog("stderr", `[openai-compatible] API error ${res.status}: ${errorBody}\n`);
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: `API call failed with status ${res.status}: ${errorBody}`,
        errorCode: "api_error",
      };
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const responseText = data.choices?.[0]?.message?.content ?? "";

    await onLog("stdout", responseText);
    await onLog("stderr", `[openai-compatible] Response received (${data.usage?.completion_tokens ?? "?"} tokens)\n`);

    // If this was a chat message, post the response back to the chat thread
    if (wakeReason === "chat_message" && context.threadId) {
      const paperclipApiUrl = process.env.PAPERCLIP_API_URL || "http://localhost:3100";
      const agentApiKey = ctx.authToken || "";

      await onLog("stderr", `[openai-compatible] Chat post-back: threadId=${context.threadId}, hasAuthToken=${!!ctx.authToken}, apiUrl=${paperclipApiUrl}\n`);

      if (agentApiKey) {
        try {
          const postUrl = `${paperclipApiUrl}/api/chat/threads/${context.threadId}/messages`;
          const postRes = await fetch(postUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${agentApiKey}`,
            },
            body: JSON.stringify({ body: responseText }),
          });
          if (postRes.ok) {
            await onLog("stderr", `[openai-compatible] Posted response to chat thread ${context.threadId}\n`);
          } else {
            const errBody = await postRes.text();
            await onLog("stderr", `[openai-compatible] Failed to post to chat thread: ${postRes.status} ${errBody}\n`);
          }
        } catch (err) {
          await onLog("stderr", `[openai-compatible] Error posting to chat thread: ${(err as Error).message}\n`);
        }
      } else {
        await onLog("stderr", `[openai-compatible] No auth token available — cannot post response back to chat thread\n`);
      }
    } else {
      await onLog("stderr", `[openai-compatible] Not a chat wake (wakeReason=${wakeReason}, threadId=${context.threadId ?? "none"}) — skipping post-back\n`);
    }

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          }
        : undefined,
      model: data.model || model,
      provider: "openai_compatible",
      billingType: "api",
      summary: responseText.slice(0, 200),
    };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return {
        exitCode: 1,
        signal: null,
        timedOut: true,
        errorMessage: `Request timed out after ${timeoutMs}ms`,
        errorCode: "timeout",
      };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
