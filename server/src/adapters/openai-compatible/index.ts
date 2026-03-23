import type { ServerAdapterModule } from "../types.js";
import { execute } from "./execute.js";
import { testEnvironment } from "./test.js";

export const openaiCompatibleAdapter: ServerAdapterModule = {
  type: "openai_compatible",
  execute,
  testEnvironment,
  models: [
    { id: "MiniMax-M2.7", label: "MiniMax M2.7 (204K context)" },
    { id: "MiniMax-M2.7-highspeed", label: "MiniMax M2.7 Highspeed" },
  ],
  agentConfigurationDoc: `# OpenAI-Compatible Adapter

Adapter: openai_compatible

Connects to any OpenAI-compatible chat completions API (MiniMax, OpenRouter, etc).

## Required Config

- **apiKey** (string): API key for the provider. Can also be set via OPENAI_COMPATIBLE_API_KEY env var.
- **model** (string): Model ID to use (default: "MiniMax-M2.7")

## Optional Config

- **baseUrl** (string): API base URL (default: "https://api.minimax.io/v1")
- **maxTokens** (number): Max output tokens (default: 4096)
- **temperature** (number): Sampling temperature (default: 0.7)
- **timeoutMs** (number): Request timeout in ms (default: 120000)
- **systemPrompt** (string): System prompt override

## Example: MiniMax M2.7

\`\`\`json
{
  "baseUrl": "https://api.minimax.io/v1",
  "apiKey": "your-minimax-api-key",
  "model": "MiniMax-M2.7"
}
\`\`\`

## Example: OpenRouter

\`\`\`json
{
  "baseUrl": "https://openrouter.ai/api/v1",
  "apiKey": "your-openrouter-key",
  "model": "minimax/minimax-m2.7"
}
\`\`\`
`,
};
