import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginEvent,
  type PluginHealthDiagnostics,
  type PluginJobContext,
  type PluginWebhookInput,
  type ToolResult,
  type ToolRunContext,
} from "@paperclipai/plugin-sdk";
import {
  DEFAULT_CONFIG,
  JOB_KEYS,
  PLUGIN_ID,
  TOOL_NAMES,
  WEBHOOK_KEYS,
} from "./constants.js";
import {
  createPullRequest,
  createRepo,
  getFileContents,
  getRepo,
  listBranches,
  listIssues,
  listOrgs,
  listOrgRepos,
  listUserRepos,
  parseRepoFromUrl,
  searchIssues,
  type GitHubIssue,
  type GitHubRepo,
} from "./github-api.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GitHubConnectorConfig = {
  githubTokenSecretRef?: string;
  autoCloneOnWorkspaceResolve?: boolean;
  autoCreateProjects?: boolean;
  syncIssuesEnabled?: boolean;
  syncIntervalMinutes?: number;
  defaultBranch?: string;
};

type ConnectedRepo = {
  slug: string;
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  language: string | null;
  connectedAt: string;
  projectId?: string;
  workspaceId?: string;
};

type ConnectedReposMap = Record<string, ConnectedRepo>;

type CloneStatus = {
  workspaceId: string;
  repoUrl: string;
  localPath: string;
  status: "cloned" | "pulled" | "failed";
  error?: string;
  at: string;
};

let currentContext: PluginContext | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getConfig(ctx: PluginContext): Promise<GitHubConnectorConfig> {
  const config = await ctx.config.get();
  return { ...DEFAULT_CONFIG, ...(config as GitHubConnectorConfig) };
}

async function resolveToken(ctx: PluginContext): Promise<string> {
  const config = await getConfig(ctx);

  // Try explicit secret ref from config first
  if (config.githubTokenSecretRef) {
    return ctx.secrets.resolve(config.githubTokenSecretRef);
  }

  // Fall back to the well-known GITHUB_TOKEN secret created by OAuth flow
  try {
    return await ctx.secrets.resolve("secret:GITHUB_TOKEN:latest");
  } catch {
    // ignore — secret doesn't exist
  }

  throw new Error(
    "GitHub not connected. Use the GitHub settings page to connect via OAuth, or set githubTokenSecretRef manually.",
  );
}

function getCompanyId(params: Record<string, unknown>): string {
  const companyId = typeof params.companyId === "string" ? params.companyId : "";
  if (!companyId) throw new Error("companyId is required");
  return companyId;
}

// ---------------------------------------------------------------------------
// Connected repos state management
// ---------------------------------------------------------------------------

async function getConnectedRepos(
  ctx: PluginContext,
  companyId: string,
): Promise<ConnectedReposMap> {
  const data = await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: "connected-repos",
  });
  return (data as ConnectedReposMap) ?? {};
}

async function setConnectedRepos(
  ctx: PluginContext,
  companyId: string,
  repos: ConnectedReposMap,
): Promise<void> {
  await ctx.state.set(
    { scopeKind: "company", scopeId: companyId, stateKey: "connected-repos" },
    repos,
  );
}

function isRepoConnected(
  repos: ConnectedReposMap,
  slug: string,
): boolean {
  return slug in repos;
}

// ---------------------------------------------------------------------------
// Git operations
// ---------------------------------------------------------------------------

async function runGit(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const mergedEnv = { ...process.env, ...env };
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: mergedEnv,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

async function cloneOrPullRepo(
  ctx: PluginContext,
  repoUrl: string,
  targetDir: string,
  branch?: string,
): Promise<CloneStatus> {
  const token = await resolveToken(ctx);
  const authedUrl = repoUrl.replace(
    "https://github.com/",
    `https://x-access-token:${token}@github.com/`,
  );
  const gitEnv = { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" };

  const dirExists = await fs
    .stat(targetDir)
    .then((s) => s.isDirectory())
    .catch(() => false);

  if (dirExists) {
    const gitDirExists = await fs
      .stat(path.join(targetDir, ".git"))
      .then((s) => s.isDirectory())
      .catch(() => false);

    if (gitDirExists) {
      ctx.logger.info("Pulling latest changes", { targetDir });
      const result = await runGit(["pull", "--ff-only"], targetDir, gitEnv);
      if (result.code !== 0) {
        await runGit(["fetch", "origin"], targetDir, gitEnv);
        const branchName =
          branch ?? (await getDefaultBranchLocal(targetDir)) ?? "main";
        await runGit(
          ["reset", "--hard", `origin/${branchName}`],
          targetDir,
          gitEnv,
        );
      }
      return {
        workspaceId: "",
        repoUrl,
        localPath: targetDir,
        status: "pulled",
        at: new Date().toISOString(),
      };
    }
  }

  await fs.mkdir(targetDir, { recursive: true });
  ctx.logger.info("Cloning repository", { repoUrl, targetDir });
  const cloneArgs = ["clone", "--depth", "1"];
  if (branch) cloneArgs.push("--branch", branch);
  cloneArgs.push(authedUrl, targetDir);

  const result = await runGit(cloneArgs, path.dirname(targetDir), gitEnv);
  if (result.code !== 0) {
    throw new Error(`git clone failed: ${result.stderr.trim()}`);
  }

  return {
    workspaceId: "",
    repoUrl,
    localPath: targetDir,
    status: "cloned",
    at: new Date().toISOString(),
  };
}

async function getDefaultBranchLocal(repoDir: string): Promise<string | null> {
  const result = await runGit(
    ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
    repoDir,
  );
  return result.code === 0
    ? result.stdout.trim().replace("origin/", "")
    : null;
}

// ---------------------------------------------------------------------------
// Sync: only operates on connected repos
// ---------------------------------------------------------------------------

async function syncConnectedRepos(ctx: PluginContext): Promise<void> {
  const config = await getConfig(ctx);
  if (!config.autoCloneOnWorkspaceResolve) return;

  const companies = await ctx.companies.list({ limit: 100, offset: 0 });
  let cloned = 0;
  let pulled = 0;
  let failed = 0;

  for (const company of companies) {
    const connectedRepos = await getConnectedRepos(ctx, company.id);
    const connectedSlugs = Object.keys(connectedRepos);
    if (connectedSlugs.length === 0) continue;

    const projects = await ctx.projects.list({
      companyId: company.id,
      limit: 100,
      offset: 0,
    });

    for (const project of projects) {
      const workspaces = await ctx.projects.listWorkspaces(
        project.id,
        company.id,
      );

      for (const workspace of workspaces) {
        if (!workspace.repoUrl) continue;
        const repoSlug = parseRepoFromUrl(workspace.repoUrl);
        if (!repoSlug || !isRepoConnected(connectedRepos, repoSlug)) continue;

        const workspacePath = workspace.path;
        const hasLocalClone =
          workspacePath &&
          (await fs
            .stat(path.join(workspacePath, ".git"))
            .then((s) => s.isDirectory())
            .catch(() => false));

        const targetDir =
          hasLocalClone && workspacePath
            ? workspacePath
            : workspacePath ||
              `/tmp/paperclip-repos/${company.id}/${repoSlug.replace("/", "-")}`;

        try {
          const status = await cloneOrPullRepo(
            ctx,
            workspace.repoUrl,
            targetDir,
            config.defaultBranch,
          );

          await ctx.state.set(
            {
              scopeKind: "project_workspace",
              scopeId: workspace.id,
              stateKey: "clone-status",
            },
            { ...status, workspaceId: workspace.id },
          );

          if (status.status === "cloned") cloned++;
          else pulled++;

          await ctx.activity.log({
            companyId: company.id,
            entityType: "project",
            entityId: project.id,
            message: `GitHub connector ${status.status} ${repoSlug} into ${targetDir}`,
            metadata: { plugin: PLUGIN_ID },
          });
        } catch (err) {
          failed++;
          ctx.logger.error("Failed to sync workspace repo", {
            workspaceId: workspace.id,
            repoUrl: workspace.repoUrl,
            error: err instanceof Error ? err.message : String(err),
          });

          await ctx.state.set(
            {
              scopeKind: "project_workspace",
              scopeId: workspace.id,
              stateKey: "clone-status",
            },
            {
              workspaceId: workspace.id,
              repoUrl: workspace.repoUrl,
              localPath: targetDir,
              status: "failed",
              error: err instanceof Error ? err.message : String(err),
              at: new Date().toISOString(),
            } satisfies CloneStatus,
          );
        }
      }
    }
  }

  await ctx.metrics.write("github.sync.repos.cloned", cloned);
  await ctx.metrics.write("github.sync.repos.pulled", pulled);
  await ctx.metrics.write("github.sync.repos.failed", failed);
  ctx.logger.info("Repo sync complete", { cloned, pulled, failed });
}

async function syncGitHubIssues(ctx: PluginContext): Promise<void> {
  const config = await getConfig(ctx);
  if (!config.syncIssuesEnabled) return;

  const token = await resolveToken(ctx);
  const companies = await ctx.companies.list({ limit: 100, offset: 0 });

  for (const company of companies) {
    const connectedRepos = await getConnectedRepos(ctx, company.id);
    if (Object.keys(connectedRepos).length === 0) continue;

    const projects = await ctx.projects.list({
      companyId: company.id,
      limit: 100,
      offset: 0,
    });

    for (const project of projects) {
      const workspaces = await ctx.projects.listWorkspaces(
        project.id,
        company.id,
      );

      for (const workspace of workspaces) {
        if (!workspace.repoUrl) continue;
        const repoSlug = parseRepoFromUrl(workspace.repoUrl);
        if (!repoSlug || !isRepoConnected(connectedRepos, repoSlug)) continue;

        const lastSyncState = (await ctx.state.get({
          scopeKind: "project_workspace",
          scopeId: workspace.id,
          stateKey: "issues-last-sync",
        })) as string | null;

        const ghIssues = await listIssues(
          ctx,
          token,
          repoSlug,
          lastSyncState ?? undefined,
          50,
        );

        const actualIssues = ghIssues.filter((i) => !i.pull_request);

        for (const ghIssue of actualIssues) {
          const existing = await ctx.entities.list({
            entityType: "github-issue",
            scopeKind: "project",
            scopeId: project.id,
            limit: 200,
            offset: 0,
          });

          const alreadySynced = existing.find(
            (e) => e.externalId === `${repoSlug}#${ghIssue.number}`,
          );

          if (!alreadySynced) {
            const paperclipIssue = await ctx.issues.create({
              companyId: company.id,
              projectId: project.id,
              title: `[GH-${ghIssue.number}] ${ghIssue.title}`,
              description: formatGitHubIssueBody(ghIssue),
            });

            await ctx.entities.upsert({
              entityType: "github-issue",
              scopeKind: "project",
              scopeId: project.id,
              externalId: `${repoSlug}#${ghIssue.number}`,
              title: ghIssue.title,
              status: ghIssue.state,
              data: {
                githubId: ghIssue.id,
                number: ghIssue.number,
                htmlUrl: ghIssue.html_url,
                paperclipIssueId: paperclipIssue.id,
                repo: repoSlug,
              },
            });
          }
        }

        await ctx.state.set(
          {
            scopeKind: "project_workspace",
            scopeId: workspace.id,
            stateKey: "issues-last-sync",
          },
          new Date().toISOString(),
        );
      }
    }
  }

  await ctx.metrics.write("github.sync.issues.completed", 1);
}

function formatGitHubIssueBody(issue: GitHubIssue): string {
  const lines = [`> Synced from GitHub: ${issue.html_url}`, ""];
  if (issue.labels.length > 0) {
    lines.push(
      `**Labels:** ${issue.labels.map((l) => l.name).join(", ")}`,
    );
  }
  if (issue.assignee) {
    lines.push(`**Assignee:** @${issue.assignee.login}`);
  }
  if (issue.body) {
    lines.push("", "---", "", issue.body);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Data handlers
// ---------------------------------------------------------------------------

async function registerDataHandlers(ctx: PluginContext): Promise<void> {
  ctx.data.register("plugin-config", async () => {
    return await getConfig(ctx);
  });

  ctx.data.register("available-repos", async (params) => {
    const companyId = getCompanyId(params);
    const org =
      typeof params.org === "string" && params.org.length > 0
        ? params.org
        : undefined;
    const token = await resolveToken(ctx);

    const repos: GitHubRepo[] = org
      ? await listOrgRepos(ctx, token, org, 100)
      : await listUserRepos(ctx, token, 100);

    const connectedRepos = await getConnectedRepos(ctx, companyId);

    return repos.map((r) => ({
      slug: r.full_name,
      cloneUrl: r.clone_url,
      htmlUrl: r.html_url,
      defaultBranch: r.default_branch,
      private: r.private,
      description: r.description,
      language: r.language,
      updatedAt: r.updated_at,
      connected: isRepoConnected(connectedRepos, r.full_name),
    }));
  });

  ctx.data.register("connected-repos", async (params) => {
    const companyId = getCompanyId(params);
    const connectedRepos = await getConnectedRepos(ctx, companyId);
    return Object.values(connectedRepos);
  });

  ctx.data.register("overview", async (params) => {
    const companyId =
      typeof params.companyId === "string" ? params.companyId : "";
    const config = await getConfig(ctx);
    const companies = await ctx.companies.list({ limit: 100, offset: 0 });

    let connectedCount = 0;
    let clonedCount = 0;
    let syncedIssues = 0;

    if (companyId) {
      const connectedRepos = await getConnectedRepos(ctx, companyId);
      connectedCount = Object.keys(connectedRepos).length;

      const projects = await ctx.projects.list({
        companyId,
        limit: 100,
        offset: 0,
      });
      for (const project of projects) {
        const workspaces = await ctx.projects.listWorkspaces(
          project.id,
          companyId,
        );
        for (const ws of workspaces) {
          if (!ws.repoUrl) continue;
          const slug = parseRepoFromUrl(ws.repoUrl);
          if (!slug || !isRepoConnected(connectedRepos, slug)) continue;
          const cloneStatus = (await ctx.state.get({
            scopeKind: "project_workspace",
            scopeId: ws.id,
            stateKey: "clone-status",
          })) as CloneStatus | null;
          if (
            cloneStatus?.status === "cloned" ||
            cloneStatus?.status === "pulled"
          ) {
            clonedCount++;
          }
        }
      }

      const syncedEntities = await ctx.entities.list({
        entityType: "github-issue",
        limit: 200,
        offset: 0,
      });
      syncedIssues = syncedEntities.length;
    }

    return {
      pluginId: PLUGIN_ID,
      config,
      companies: companies.length,
      connectedRepos: connectedCount,
      clonedRepos: clonedCount,
      syncedIssues,
      tokenConfigured: Boolean(config.githubTokenSecretRef),
    };
  });

  ctx.data.register("orgs", async () => {
    const token = await resolveToken(ctx);
    return listOrgs(ctx, token);
  });

  ctx.data.register("workspace-statuses", async (params) => {
    const companyId = getCompanyId(params);
    const connectedRepos = await getConnectedRepos(ctx, companyId);
    const projects = await ctx.projects.list({
      companyId,
      limit: 100,
      offset: 0,
    });

    const statuses: Array<{
      projectName: string;
      workspaceName: string;
      workspaceId: string;
      repoUrl: string | null;
      repoSlug: string | null;
      connected: boolean;
      cloneStatus: CloneStatus | null;
    }> = [];

    for (const project of projects) {
      const workspaces = await ctx.projects.listWorkspaces(
        project.id,
        companyId,
      );
      for (const ws of workspaces) {
        const slug = ws.repoUrl ? parseRepoFromUrl(ws.repoUrl) : null;
        const connected = slug ? isRepoConnected(connectedRepos, slug) : false;
        const cloneStatus =
          ws.repoUrl && connected
            ? ((await ctx.state.get({
                scopeKind: "project_workspace",
                scopeId: ws.id,
                stateKey: "clone-status",
              })) as CloneStatus | null)
            : null;

        statuses.push({
          projectName: project.name,
          workspaceName: ws.name,
          workspaceId: ws.id,
          repoUrl: ws.repoUrl,
          repoSlug: slug,
          connected,
          cloneStatus,
        });
      }
    }
    return statuses;
  });
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function registerActionHandlers(ctx: PluginContext): Promise<void> {
  ctx.actions.register("connect-repo", async (params) => {
    const companyId = getCompanyId(params);
    const slug = typeof params.slug === "string" ? params.slug : "";
    if (!slug) throw new Error("slug is required (e.g. owner/repo)");

    const token = await resolveToken(ctx);
    const repo = await getRepo(ctx, token, slug);

    const connectedRepos = await getConnectedRepos(ctx, companyId);

    if (isRepoConnected(connectedRepos, slug)) {
      return { ok: true, message: `${slug} is already connected`, alreadyConnected: true };
    }

    const entry: ConnectedRepo = {
      slug: repo.full_name,
      cloneUrl: repo.clone_url,
      defaultBranch: repo.default_branch,
      private: repo.private,
      description: repo.description,
      language: repo.language,
      connectedAt: new Date().toISOString(),
    };

    // Auto-create project + workspace if enabled
    const config = await getConfig(ctx);
    if (config.autoCreateProjects) {
      const existingProjects = await ctx.projects.list({
        companyId,
        limit: 200,
        offset: 0,
      });
      const existingProject = existingProjects.find((p) => {
        return p.name.toLowerCase() === repo.name.toLowerCase();
      });

      if (existingProject) {
        entry.projectId = existingProject.id;
        ctx.logger.info("Project already exists, linking repo", {
          projectId: existingProject.id,
          slug,
        });
      }
      // Note: project creation requires the REST API which isn't available
      // via the plugin SDK. The project + workspace must be created from the
      // board UI. The connector will track connection state and sync once
      // a workspace with this repoUrl exists.
    }

    connectedRepos[slug] = entry;
    await setConnectedRepos(ctx, companyId, connectedRepos);

    await ctx.activity.log({
      companyId,
      message: `Connected GitHub repo ${slug}`,
      metadata: { plugin: PLUGIN_ID, repo: slug },
    });

    await ctx.metrics.write("github.repos.connected", 1);

    return {
      ok: true,
      message: `Connected ${slug}`,
      repo: entry,
    };
  });

  ctx.actions.register("disconnect-repo", async (params) => {
    const companyId = getCompanyId(params);
    const slug = typeof params.slug === "string" ? params.slug : "";
    if (!slug) throw new Error("slug is required (e.g. owner/repo)");

    const connectedRepos = await getConnectedRepos(ctx, companyId);
    if (!isRepoConnected(connectedRepos, slug)) {
      return { ok: true, message: `${slug} is not connected` };
    }

    delete connectedRepos[slug];
    await setConnectedRepos(ctx, companyId, connectedRepos);

    await ctx.activity.log({
      companyId,
      message: `Disconnected GitHub repo ${slug}`,
      metadata: { plugin: PLUGIN_ID, repo: slug },
    });

    return { ok: true, message: `Disconnected ${slug}` };
  });

  ctx.actions.register("sync-repos-now", async (params) => {
    await syncConnectedRepos(ctx);
    return { ok: true };
  });

  ctx.actions.register("sync-issues-now", async (params) => {
    await syncGitHubIssues(ctx);
    return { ok: true };
  });

  ctx.actions.register("test-connection", async () => {
    const token = await resolveToken(ctx);
    const repos = await listUserRepos(ctx, token, 1);
    return {
      ok: true,
      message: `Connected. Found repos including: ${repos[0]?.full_name ?? "none"}`,
    };
  });

  ctx.actions.register("create-repo", async (params) => {
    const companyId = getCompanyId(params);
    const name = typeof params.name === "string" ? params.name.trim() : "";
    const org = typeof params.org === "string" && params.org.length > 0 ? params.org : undefined;
    const description = typeof params.description === "string" ? params.description : undefined;
    const isPrivate = params.private !== false;

    if (!name) throw new Error("name is required");

    const token = await resolveToken(ctx);
    const repo = await createRepo(ctx, token, {
      name,
      org,
      description,
      private: isPrivate,
      autoInit: true,
    });

    // Auto-connect the new repo
    const connectedRepos = await getConnectedRepos(ctx, companyId);
    connectedRepos[repo.full_name] = {
      slug: repo.full_name,
      cloneUrl: repo.clone_url,
      defaultBranch: repo.default_branch,
      private: repo.private,
      description: repo.description,
      language: repo.language,
      connectedAt: new Date().toISOString(),
    };
    await setConnectedRepos(ctx, companyId, connectedRepos);

    await ctx.activity.log({
      companyId,
      message: `Created and connected GitHub repo ${repo.full_name}`,
      metadata: { plugin: PLUGIN_ID, repo: repo.full_name },
    });

    return {
      ok: true,
      repo: {
        slug: repo.full_name,
        cloneUrl: repo.clone_url,
        htmlUrl: repo.html_url,
        defaultBranch: repo.default_branch,
        private: repo.private,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Tool handlers (agent-callable)
// ---------------------------------------------------------------------------

async function registerToolHandlers(ctx: PluginContext): Promise<void> {
  ctx.tools.register(
    TOOL_NAMES.cloneRepo,
    {
      displayName: "Clone GitHub Repo",
      description:
        "Clones a connected GitHub repository into the agent workspace. If already cloned, pulls latest.",
      parametersSchema: {
        type: "object",
        properties: {
          repoUrl: { type: "string" },
          branch: { type: "string" },
          targetDir: { type: "string" },
        },
        required: ["repoUrl"],
      },
    },
    async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
      const { repoUrl, branch, targetDir } = params as {
        repoUrl: string;
        branch?: string;
        targetDir?: string;
      };

      const repoSlug = parseRepoFromUrl(repoUrl);
      if (repoSlug) {
        const connected = await getConnectedRepos(ctx, runCtx.companyId);
        if (!isRepoConnected(connected, repoSlug)) {
          return {
            error: `Repository ${repoSlug} is not connected. Connect it from the GitHub plugin page first.`,
          };
        }
      }

      const dirName = targetDir || repoSlug?.replace("/", "-") || "repo";
      const basePath = `/tmp/paperclip-repos/${runCtx.companyId}`;
      const fullPath = path.resolve(basePath, dirName);

      const status = await cloneOrPullRepo(ctx, repoUrl, fullPath, branch);

      return {
        content: `Repository ${status.status} at ${fullPath}`,
        data: { ...status, localPath: fullPath },
      };
    },
  );

  ctx.tools.register(
    TOOL_NAMES.listRepos,
    {
      displayName: "List Connected GitHub Repos",
      description:
        "Lists GitHub repositories that are connected to this company.",
      parametersSchema: {
        type: "object",
        properties: {
          org: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
    async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
      const connected = await getConnectedRepos(ctx, runCtx.companyId);
      const repos = Object.values(connected);

      if (repos.length === 0) {
        return {
          content:
            "No repos are connected. Connect repos from the GitHub plugin page.",
          data: [],
        };
      }

      const summary = repos
        .map(
          (r) =>
            `- ${r.slug}${r.private ? " (private)" : ""}: ${r.description ?? "no description"} [${r.language ?? "unknown"}]`,
        )
        .join("\n");

      return {
        content: `${repos.length} connected repos:\n${summary}`,
        data: repos,
      };
    },
  );

  ctx.tools.register(
    TOOL_NAMES.searchIssues,
    {
      displayName: "Search GitHub Issues",
      description: "Searches GitHub issues and PRs.",
      parametersSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          repo: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { query, repo, limit } = params as {
        query: string;
        repo?: string;
        limit?: number;
      };
      const token = await resolveToken(ctx);
      const fullQuery = repo ? `${query} repo:${repo}` : query;
      const result = await searchIssues(ctx, token, fullQuery, limit);

      const summary = result.items
        .map((i) => `- #${i.number} ${i.title} [${i.state}] ${i.html_url}`)
        .join("\n");

      return {
        content: `Found ${result.total_count} results:\n${summary}`,
        data: result.items.map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          url: i.html_url,
          labels: i.labels.map((l) => l.name),
        })),
      };
    },
  );

  ctx.tools.register(
    TOOL_NAMES.createPr,
    {
      displayName: "Create Pull Request",
      description: "Creates a pull request on GitHub.",
      parametersSchema: {
        type: "object",
        properties: {
          repo: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          head: { type: "string" },
          base: { type: "string" },
        },
        required: ["repo", "title", "head"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { repo, title, body, head, base } = params as {
        repo: string;
        title: string;
        body?: string;
        head: string;
        base?: string;
      };
      const token = await resolveToken(ctx);
      const config = await getConfig(ctx);
      const pr = await createPullRequest(
        ctx,
        token,
        repo,
        title,
        head,
        base ?? config.defaultBranch ?? "main",
        body,
      );

      return {
        content: `Created PR #${pr.number}: ${pr.html_url}`,
        data: {
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          state: pr.state,
        },
      };
    },
  );

  ctx.tools.register(
    TOOL_NAMES.getFileContents,
    {
      displayName: "Get File Contents",
      description: "Reads a file from a GitHub repository.",
      parametersSchema: {
        type: "object",
        properties: {
          repo: { type: "string" },
          path: { type: "string" },
          ref: { type: "string" },
        },
        required: ["repo", "path"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { repo, path: filePath, ref } = params as {
        repo: string;
        path: string;
        ref?: string;
      };
      const token = await resolveToken(ctx);
      const file = await getFileContents(ctx, token, repo, filePath, ref);
      const decoded =
        file.encoding === "base64"
          ? Buffer.from(file.content, "base64").toString("utf8")
          : file.content;

      return {
        content: decoded,
        data: { path: file.path, sha: file.sha, size: file.size },
      };
    },
  );

  ctx.tools.register(
    TOOL_NAMES.listBranches,
    {
      displayName: "List Branches",
      description: "Lists branches for a GitHub repository.",
      parametersSchema: {
        type: "object",
        properties: {
          repo: { type: "string" },
          limit: { type: "number" },
        },
        required: ["repo"],
      },
    },
    async (params): Promise<ToolResult> => {
      const { repo, limit } = params as { repo: string; limit?: number };
      const token = await resolveToken(ctx);
      const branches = await listBranches(ctx, token, repo, limit);

      const summary = branches
        .map(
          (b) =>
            `- ${b.name} (${b.commit.sha.slice(0, 7)})${b.protected ? " [protected]" : ""}`,
        )
        .join("\n");

      return {
        content: `${branches.length} branches:\n${summary}`,
        data: branches.map((b) => ({
          name: b.name,
          sha: b.commit.sha,
          protected: b.protected,
        })),
      };
    },
  );

  ctx.tools.register(
    TOOL_NAMES.createRepo,
    {
      displayName: "Create GitHub Repository",
      description: "Creates a new GitHub repository in a user account or organization.",
      parametersSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          org: { type: "string" },
          description: { type: "string" },
          private: { type: "boolean" },
        },
        required: ["name"],
      },
    },
    async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
      const { name, org, description } = params as {
        name: string;
        org?: string;
        description?: string;
        private?: boolean;
      };
      const isPrivate = (params as { private?: boolean }).private !== false;
      const token = await resolveToken(ctx);

      const repo = await createRepo(ctx, token, {
        name,
        org,
        description,
        private: isPrivate,
        autoInit: true,
      });

      // Auto-connect
      const connected = await getConnectedRepos(ctx, runCtx.companyId);
      connected[repo.full_name] = {
        slug: repo.full_name,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch,
        private: repo.private,
        description: repo.description,
        language: repo.language,
        connectedAt: new Date().toISOString(),
      };
      await setConnectedRepos(ctx, runCtx.companyId, connected);

      return {
        content: `Created repo ${repo.full_name}: ${repo.html_url}`,
        data: {
          slug: repo.full_name,
          cloneUrl: repo.clone_url,
          htmlUrl: repo.html_url,
          defaultBranch: repo.default_branch,
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Event & job handlers
// ---------------------------------------------------------------------------

async function registerEventHandlers(ctx: PluginContext): Promise<void> {
  ctx.events.on("issue.created", async (event: PluginEvent) => {
    ctx.logger.debug("Observed issue.created", { issueId: event.entityId });
  });
}

async function registerJobs(ctx: PluginContext): Promise<void> {
  ctx.jobs.register(JOB_KEYS.syncRepos, async (job: PluginJobContext) => {
    ctx.logger.info("Running repo sync job", { runId: job.runId });
    await syncConnectedRepos(ctx);
    await ctx.state.set(
      { scopeKind: "instance", stateKey: "last-repo-sync" },
      {
        runId: job.runId,
        trigger: job.trigger,
        completedAt: new Date().toISOString(),
      },
    );
  });

  ctx.jobs.register(JOB_KEYS.syncIssues, async (job: PluginJobContext) => {
    ctx.logger.info("Running issue sync job", { runId: job.runId });
    await syncGitHubIssues(ctx);
    await ctx.state.set(
      { scopeKind: "instance", stateKey: "last-issue-sync" },
      {
        runId: job.runId,
        trigger: job.trigger,
        completedAt: new Date().toISOString(),
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;
    ctx.logger.info("GitHub Connector starting up");
    await registerEventHandlers(ctx);
    await registerJobs(ctx);
    await registerDataHandlers(ctx);
    await registerActionHandlers(ctx);
    await registerToolHandlers(ctx);
    ctx.logger.info("GitHub Connector ready");
  },

  async onHealth(): Promise<PluginHealthDiagnostics> {
    const ctx = currentContext;
    if (!ctx) {
      return { status: "degraded", message: "Plugin not initialized" };
    }
    const config = await getConfig(ctx);
    const tokenConfigured = Boolean(config.githubTokenSecretRef);
    return {
      status: tokenConfigured ? "ok" : "degraded",
      message: tokenConfigured
        ? "GitHub Connector ready"
        : "GitHub token not configured",
      details: {
        tokenConfigured,
        autoClone: config.autoCloneOnWorkspaceResolve,
        autoCreateProjects: config.autoCreateProjects,
        issueSync: config.syncIssuesEnabled,
      },
    };
  },

  async onConfigChanged(newConfig) {
    currentContext?.logger.info("GitHub Connector config updated", {
      keys: Object.keys(newConfig),
    });
  },

  async onValidateConfig(config) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const typed = config as GitHubConnectorConfig;

    if (!typed.githubTokenSecretRef) {
      warnings.push(
        "No explicit githubTokenSecretRef set. The plugin will use the GITHUB_TOKEN secret from OAuth if available.",
      );
    }
    if (
      typed.syncIntervalMinutes !== undefined &&
      (typed.syncIntervalMinutes < 5 || typed.syncIntervalMinutes > 1440)
    ) {
      errors.push("syncIntervalMinutes must be between 5 and 1440.");
    }
    if (typed.syncIssuesEnabled && !typed.githubTokenSecretRef) {
      warnings.push(
        "Issue sync enabled but no token configured. Sync will fail.",
      );
    }

    return { ok: errors.length === 0, warnings, errors };
  },

  async onWebhook(input: PluginWebhookInput) {
    if (input.endpointKey !== WEBHOOK_KEYS.githubEvent) {
      throw new Error(`Unknown webhook endpoint "${input.endpointKey}"`);
    }

    const ctx = currentContext;
    if (!ctx) return;

    const headers = input.headers as Record<string, string>;
    const event = headers["x-github-event"] ?? "unknown";

    ctx.logger.info("Received GitHub webhook", {
      event,
      delivery: headers["x-github-delivery"],
    });

    await ctx.state.set(
      { scopeKind: "instance", stateKey: "last-webhook" },
      {
        event,
        delivery: headers["x-github-delivery"],
        receivedAt: new Date().toISOString(),
      },
    );

    const body = input.parsedBody as Record<string, unknown>;

    if (event === "push") {
      const repo = (body.repository as Record<string, unknown>)
        ?.full_name as string;
      if (repo) {
        ctx.logger.info("Push received, triggering sync for connected repos", {
          repo,
        });
        await ctx.events.emit("repo-pushed", "", { repo, ref: body.ref });
        await syncConnectedRepos(ctx);
      }
    }

    if (event === "issues") {
      const action = body.action as string;
      const issue = body.issue as GitHubIssue;
      ctx.logger.info("Issue event received", {
        action,
        number: issue?.number,
      });
    }

    await ctx.metrics.write("github.webhooks.received", 1, { event });
  },

  async onShutdown() {
    currentContext?.logger.info("GitHub Connector shutting down");
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
