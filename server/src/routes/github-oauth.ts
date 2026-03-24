import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { pluginConfig, plugins } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { secretService } from "../services/index.js";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

const GITHUB_SECRET_NAME = "GITHUB_TOKEN";
const GITHUB_SCOPES = "repo,read:org";

function getGitHubClientId(): string {
  return process.env.GITHUB_OAUTH_CLIENT_ID ?? process.env.GITHUB_CLIENT_ID ?? "";
}

function getGitHubClientSecret(): string {
  return process.env.GITHUB_OAUTH_CLIENT_SECRET ?? process.env.GITHUB_CLIENT_SECRET ?? "";
}

export function githubOAuthRoutes(db: Db) {
  const router = Router();
  const secrets = secretService(db);

  /**
   * GET /api/github/oauth/authorize?companyId=...
   *
   * Initiates the GitHub OAuth flow. Redirects the user to GitHub's auth page.
   * The companyId is passed through via the state parameter so we know which
   * company to store the token for when GitHub redirects back.
   */
  router.get("/github/oauth/authorize", (req, res) => {
    assertBoard(req);
    const companyId = req.query.companyId as string;
    if (!companyId) {
      res.status(400).json({ error: "companyId query parameter is required" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const clientId = getGitHubClientId();
    if (!clientId) {
      res.status(500).json({ error: "GitHub OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID." });
      return;
    }

    const publicUrl = process.env.PAPERCLIP_PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${publicUrl}/api/github/oauth/callback`;
    const state = Buffer.from(JSON.stringify({ companyId })).toString("base64url");

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: GITHUB_SCOPES,
      state,
    });

    res.redirect(`${GITHUB_AUTHORIZE_URL}?${params.toString()}`);
  });

  /**
   * GET /api/github/oauth/callback?code=...&state=...
   *
   * GitHub redirects here after the user authorizes. Exchanges the code for
   * an access token, stores it as a company secret, and redirects back to
   * the plugin settings page.
   */
  router.get("/github/oauth/callback", async (req, res) => {
    const code = req.query.code as string;
    const stateParam = req.query.state as string;

    if (!code || !stateParam) {
      res.status(400).json({ error: "Missing code or state parameter" });
      return;
    }

    let companyId: string;
    try {
      const parsed = JSON.parse(Buffer.from(stateParam, "base64url").toString());
      companyId = parsed.companyId;
      if (!companyId) throw new Error("missing companyId");
    } catch {
      res.status(400).json({ error: "Invalid state parameter" });
      return;
    }

    const clientId = getGitHubClientId();
    const clientSecret = getGitHubClientSecret();
    if (!clientId || !clientSecret) {
      res.status(500).json({ error: "GitHub OAuth not configured on server" });
      return;
    }

    // Exchange code for access token
    const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      res.status(400).json({
        error: "GitHub token exchange failed",
        detail: tokenData.error_description ?? tokenData.error,
      });
      return;
    }

    // Verify the token works by fetching user info
    const userResponse = await fetch(GITHUB_USER_URL, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github+json",
      },
    });
    const userData = (await userResponse.json()) as {
      login?: string;
      id?: number;
    };

    // Store or update the secret
    const existingSecrets = await secrets.list(companyId);
    const existingGithubSecret = existingSecrets.find(
      (s) => s.name === GITHUB_SECRET_NAME,
    );

    let secretId: string;
    if (existingGithubSecret) {
      await secrets.rotate(existingGithubSecret.id, {
        value: tokenData.access_token,
      }, { userId: req.actor?.userId ?? "board", agentId: null });
      secretId = existingGithubSecret.id;
    } else {
      const created = await secrets.create(companyId, {
        name: GITHUB_SECRET_NAME,
        provider: "local_encrypted",
        value: tokenData.access_token,
        description: `GitHub token for @${userData.login ?? "unknown"} (connected via OAuth)`,
      }, { userId: req.actor?.userId ?? "board", agentId: null });
      secretId = created.id;
    }

    // Update the GitHub connector plugin config with the secret UUID
    // so the worker can resolve it via ctx.secrets.resolve()
    const PLUGIN_KEY = "paperclip-github-connector";
    const pluginRow = await db
      .select({ id: plugins.id })
      .from(plugins)
      .where(eq(plugins.pluginKey, PLUGIN_KEY))
      .then((rows) => rows[0] ?? null);

    if (pluginRow) {
      const existingConfig = await db
        .select()
        .from(pluginConfig)
        .where(eq(pluginConfig.pluginId, pluginRow.id))
        .then((rows) => rows[0] ?? null);

      const currentConfig = (existingConfig?.configJson as Record<string, unknown>) ?? {};
      const updatedConfig = { ...currentConfig, githubTokenSecretRef: secretId };

      if (existingConfig) {
        await db
          .update(pluginConfig)
          .set({ configJson: updatedConfig, updatedAt: new Date() })
          .where(eq(pluginConfig.pluginId, pluginRow.id));
      } else {
        await db.insert(pluginConfig).values({
          pluginId: pluginRow.id,
          configJson: updatedConfig,
        });
      }
    }

    // Redirect back to the plugins page
    const redirectUrl = `/instance/settings/plugins?github=connected&user=${encodeURIComponent(userData.login ?? "")}`;
    res.redirect(redirectUrl);
  });

  /**
   * GET /api/github/oauth/status?companyId=...
   *
   * Returns whether GitHub is connected for this company (has a GITHUB_TOKEN secret).
   */
  router.get("/github/oauth/status", async (req, res) => {
    assertBoard(req);
    const companyId = req.query.companyId as string;
    if (!companyId) {
      res.status(400).json({ error: "companyId query parameter is required" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const existingSecrets = await secrets.list(companyId);
    const githubSecret = existingSecrets.find(
      (s) => s.name === GITHUB_SECRET_NAME,
    );

    const oauthConfigured = Boolean(getGitHubClientId());

    res.json({
      connected: Boolean(githubSecret),
      secretId: githubSecret?.id ?? null,
      secretRef: githubSecret ? `secret:${githubSecret.id}:latest` : null,
      description: githubSecret?.description ?? null,
      oauthConfigured,
    });
  });

  /**
   * DELETE /api/github/oauth/disconnect?companyId=...
   *
   * Removes the GitHub token secret for this company.
   */
  router.delete("/github/oauth/disconnect", async (req, res) => {
    assertBoard(req);
    const companyId = req.query.companyId as string;
    if (!companyId) {
      res.status(400).json({ error: "companyId query parameter is required" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const existingSecrets = await secrets.list(companyId);
    const githubSecret = existingSecrets.find(
      (s) => s.name === GITHUB_SECRET_NAME,
    );

    if (githubSecret) {
      await secrets.remove(githubSecret.id);
    }

    res.json({ ok: true, disconnected: Boolean(githubSecret) });
  });

  return router;
}
