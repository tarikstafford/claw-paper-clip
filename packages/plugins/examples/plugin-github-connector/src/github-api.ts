import type { PluginContext } from "@paperclipai/plugin-sdk";

export interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  html_url: string;
  clone_url: string;
  default_branch: string;
  private: boolean;
  description: string | null;
  language: string | null;
  updated_at: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  labels: Array<{ name: string }>;
  assignee: { login: string } | null;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
  head: { ref: string };
  base: { ref: string };
}

export interface GitHubSearchResult<T> {
  total_count: number;
  items: T[];
}

export interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string;
  encoding: string;
}

const GITHUB_API = "https://api.github.com";

async function githubFetch<T>(
  ctx: PluginContext,
  token: string,
  endpoint: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const url = endpoint.startsWith("http") ? endpoint : `${GITHUB_API}${endpoint}`;
  const init: RequestInit = {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Paperclip-GitHub-Connector/0.1",
    },
  };
  if (options?.body) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await ctx.http.fetch(url, init);
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub API ${options?.method ?? "GET"} ${endpoint} failed (${response.status}): ${errorBody.slice(0, 500)}`);
  }
  return (await response.json()) as T;
}

export async function listUserRepos(
  ctx: PluginContext,
  token: string,
  limit = 30,
): Promise<GitHubRepo[]> {
  return githubFetch<GitHubRepo[]>(
    ctx,
    token,
    `/user/repos?sort=updated&per_page=${Math.min(limit, 100)}&type=all`,
  );
}

export async function listOrgRepos(
  ctx: PluginContext,
  token: string,
  org: string,
  limit = 30,
): Promise<GitHubRepo[]> {
  return githubFetch<GitHubRepo[]>(
    ctx,
    token,
    `/orgs/${encodeURIComponent(org)}/repos?sort=updated&per_page=${Math.min(limit, 100)}`,
  );
}

export async function getRepo(
  ctx: PluginContext,
  token: string,
  repo: string,
): Promise<GitHubRepo> {
  return githubFetch<GitHubRepo>(ctx, token, `/repos/${repo}`);
}

export async function listIssues(
  ctx: PluginContext,
  token: string,
  repo: string,
  since?: string,
  limit = 50,
): Promise<GitHubIssue[]> {
  let endpoint = `/repos/${repo}/issues?state=open&per_page=${Math.min(limit, 100)}&sort=updated&direction=desc`;
  if (since) endpoint += `&since=${since}`;
  return githubFetch<GitHubIssue[]>(ctx, token, endpoint);
}

export async function searchIssues(
  ctx: PluginContext,
  token: string,
  query: string,
  limit = 20,
): Promise<GitHubSearchResult<GitHubIssue>> {
  return githubFetch<GitHubSearchResult<GitHubIssue>>(
    ctx,
    token,
    `/search/issues?q=${encodeURIComponent(query)}&per_page=${Math.min(limit, 100)}`,
  );
}

export async function listBranches(
  ctx: PluginContext,
  token: string,
  repo: string,
  limit = 30,
): Promise<GitHubBranch[]> {
  return githubFetch<GitHubBranch[]>(
    ctx,
    token,
    `/repos/${repo}/branches?per_page=${Math.min(limit, 100)}`,
  );
}

export async function createPullRequest(
  ctx: PluginContext,
  token: string,
  repo: string,
  title: string,
  head: string,
  base: string,
  body?: string,
): Promise<GitHubPullRequest> {
  return githubFetch<GitHubPullRequest>(ctx, token, `/repos/${repo}/pulls`, {
    method: "POST",
    body: { title, head, base, body: body ?? "" },
  });
}

export async function getFileContents(
  ctx: PluginContext,
  token: string,
  repo: string,
  filePath: string,
  ref?: string,
): Promise<GitHubFileContent> {
  let endpoint = `/repos/${repo}/contents/${filePath}`;
  if (ref) endpoint += `?ref=${encodeURIComponent(ref)}`;
  return githubFetch<GitHubFileContent>(ctx, token, endpoint);
}

export async function createRepo(
  ctx: PluginContext,
  token: string,
  options: {
    name: string;
    org?: string;
    description?: string;
    private?: boolean;
    autoInit?: boolean;
  },
): Promise<GitHubRepo> {
  const endpoint = options.org
    ? `/orgs/${encodeURIComponent(options.org)}/repos`
    : "/user/repos";
  return githubFetch<GitHubRepo>(ctx, token, endpoint, {
    method: "POST",
    body: {
      name: options.name,
      description: options.description ?? "",
      private: options.private ?? true,
      auto_init: options.autoInit ?? true,
    },
  });
}

export async function listOrgs(
  ctx: PluginContext,
  token: string,
): Promise<Array<{ login: string; id: number }>> {
  return githubFetch<Array<{ login: string; id: number }>>(
    ctx,
    token,
    "/user/orgs?per_page=100",
  );
}

export function parseRepoFromUrl(url: string): string | null {
  const match = url.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/);
  return match?.[1] ?? null;
}
