import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import { asString, asNumber } from "../utils.js";

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

// Paths where Paperclip skill files may live (Docker and local dev)
const SKILL_CANDIDATES = [
  "/app/skills/paperclip/SKILL.md",
  "skills/paperclip/SKILL.md",
];

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function loadPaperclipSkill(): Promise<string> {
  for (const candidate of SKILL_CANDIDATES) {
    const content = await readFileIfExists(candidate);
    if (content) return content;
  }
  return "";
}

async function loadInstructionsFile(filePath: string): Promise<string> {
  if (!filePath) return "";
  const content = await readFileIfExists(filePath);
  return content ?? "";
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

  // Build system prompt with full context
  const instructionsFilePath = asString(config.instructionsFilePath, "");
  const [paperclipSkill, agentInstructions] = await Promise.all([
    loadPaperclipSkill(),
    loadInstructionsFile(instructionsFilePath),
  ]);

  const customSystemPrompt = asString(config.systemPrompt, "");
  const chatThreadContext = asString(context.paperclipChatThreadContext, "");
  const wakeReason = asString(context.wakeReason, "");
  const threadId = asString(context.threadId, "");

  // Compose system prompt with identity, instructions, and Paperclip skill
  const systemParts: string[] = [];

  // Identity
  systemParts.push(`You are agent ${agent.id} (${agent.name}), company ${agent.companyId}. You work on the Paperclip platform.`);

  // Environment info
  systemParts.push(`Environment:
- PAPERCLIP_AGENT_ID: ${agent.id}
- PAPERCLIP_COMPANY_ID: ${agent.companyId}
- PAPERCLIP_API_URL: ${process.env.PAPERCLIP_API_URL || "http://localhost:3100"}
- PAPERCLIP_RUN_ID: ${runId}`);

  // Custom system prompt from config
  if (customSystemPrompt) {
    systemParts.push(customSystemPrompt);
  }

  // Agent instructions file (AGENTS.md)
  if (agentInstructions) {
    systemParts.push(`## Agent Instructions\n\n${agentInstructions}`);
  }

  // Paperclip skill (heartbeat procedure, API reference)
  if (paperclipSkill) {
    systemParts.push(`## Paperclip Skill\n\n${paperclipSkill}`);
  }

  // Chat mode preamble
  if (wakeReason === "chat_message") {
    systemParts.push(`This run was triggered by a chat message, not a scheduled heartbeat. Respond to the conversation naturally and concisely. Only use the Paperclip API if the user explicitly asks about tasks, status, assignments, or work. Do NOT run the full heartbeat procedure unless the user asks for it.`);
  }

  const systemPrompt = systemParts.join("\n\n---\n\n");

  // Build messages array
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  // Parse chat thread context into messages
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
        messages.push({ role: "user", content: line.trim() });
      }
    }
  } else {
    const prompt = asString(context.prompt, `Continue your work as ${agent.name}.`);
    messages.push({ role: "user", content: prompt });
  }

  // Emit invocation metadata
  await onMeta?.({
    adapterType: "openai_compatible",
    command: `POST ${baseUrl}/chat/completions`,
    prompt: messages.map((m) => `[${m.role}]: ${m.content.slice(0, 200)}`).join("\n"),
    context,
  });

  await onLog("stderr", `[openai-compatible] Calling ${baseUrl}/chat/completions (model: ${model})\n`);
  if (agentInstructions) await onLog("stderr", `[openai-compatible] Loaded instructions from ${instructionsFilePath}\n`);
  if (paperclipSkill) await onLog("stderr", `[openai-compatible] Loaded Paperclip skill\n`);

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

    // Strip <think>...</think> tags from response before posting
    const cleanResponse = responseText.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();

    await onLog("stdout", responseText);
    await onLog("stderr", `[openai-compatible] Response received (${data.usage?.completion_tokens ?? "?"} tokens)\n`);

    // Post response back to chat thread
    if (wakeReason === "chat_message" && threadId) {
      const paperclipApiUrl = process.env.PAPERCLIP_API_URL || "http://localhost:3100";
      const agentAuthToken = ctx.authToken || "";

      await onLog("stderr", `[openai-compatible] Chat post-back: threadId=${threadId}, hasAuthToken=${!!ctx.authToken}, apiUrl=${paperclipApiUrl}\n`);

      if (agentAuthToken) {
        try {
          const postUrl = `${paperclipApiUrl}/api/chat/threads/${threadId}/messages`;
          const postRes = await fetch(postUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${agentAuthToken}`,
            },
            body: JSON.stringify({ body: cleanResponse }),
          });
          if (postRes.ok) {
            await onLog("stderr", `[openai-compatible] Posted response to chat thread ${threadId}\n`);
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
      await onLog("stderr", `[openai-compatible] Not a chat wake (wakeReason=${wakeReason}, threadId=${threadId || "none"}) — skipping post-back\n`);
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
      summary: cleanResponse.slice(0, 200),
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
