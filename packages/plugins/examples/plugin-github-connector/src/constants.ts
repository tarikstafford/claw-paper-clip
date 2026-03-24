export const PLUGIN_ID = "paperclip-github-connector";
export const PLUGIN_VERSION = "0.1.0";
export const PAGE_ROUTE = "github";

export const SLOT_IDS = {
  page: "github-page",
  settingsPage: "github-settings-page",
  dashboardWidget: "github-dashboard-widget",
  projectTab: "github-project-tab",
  issueTab: "github-issue-tab",
} as const;

export const EXPORT_NAMES = {
  page: "GitHubPage",
  settingsPage: "GitHubSettingsPage",
  dashboardWidget: "GitHubDashboardWidget",
  projectTab: "GitHubProjectTab",
  issueTab: "GitHubIssueTab",
} as const;

export const JOB_KEYS = {
  syncRepos: "sync-repos",
  syncIssues: "sync-issues",
} as const;

export const WEBHOOK_KEYS = {
  githubEvent: "github-event",
} as const;

export const TOOL_NAMES = {
  cloneRepo: "clone-repo",
  listRepos: "list-repos",
  searchIssues: "search-issues",
  createPr: "create-pr",
  getFileContents: "get-file-contents",
  listBranches: "list-branches",
} as const;

export const DEFAULT_CONFIG = {
  autoCloneOnWorkspaceResolve: true,
  autoCreateProjects: false,
  syncIssuesEnabled: false,
  syncIntervalMinutes: 30,
  defaultBranch: "main",
} as const;
