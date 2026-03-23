import type { AdapterEnvironmentTestContext, AdapterEnvironmentTestResult } from "../types.js";

export async function testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  const config = ctx.config;
  const apiKey = (config.apiKey as string) || process.env.OPENAI_COMPATIBLE_API_KEY || "";
  const baseUrl = (config.baseUrl as string) || "https://api.minimax.io/v1";

  const checks = [];

  if (!apiKey) {
    checks.push({
      code: "missing_api_key",
      level: "error" as const,
      message: "No API key configured",
      hint: "Set apiKey in adapter config or OPENAI_COMPATIBLE_API_KEY environment variable",
    });
  } else {
    checks.push({
      code: "api_key_present",
      level: "info" as const,
      message: "API key configured",
    });
  }

  checks.push({
    code: "base_url",
    level: "info" as const,
    message: `Base URL: ${baseUrl}`,
  });

  const status = checks.some((c) => c.level === "error") ? "fail" : "pass";

  return {
    adapterType: "openai_compatible",
    status,
    checks,
    testedAt: new Date().toISOString(),
  };
}
