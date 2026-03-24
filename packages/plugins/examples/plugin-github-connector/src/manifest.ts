import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  DEFAULT_CONFIG,
  EXPORT_NAMES,
  JOB_KEYS,
  PAGE_ROUTE,
  PLUGIN_ID,
  PLUGIN_VERSION,
  SLOT_IDS,
  TOOL_NAMES,
  WEBHOOK_KEYS,
} from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "GitHub Connector",
  description:
    "Connects Paperclip to GitHub — auto-clones repos into agent workspaces, syncs issues, receives webhooks, and provides agent tools for GitHub operations.",
  author: "Paperclip",
  categories: ["connector", "workspace", "automation"],
  capabilities: [
    "companies.read",
    "projects.read",
    "projects.create",
    "project.workspaces.read",
    "project.workspaces.write",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.read",
    "issue.comments.create",
    "agents.read",
    "activity.log.write",
    "metrics.write",
    "plugin.state.read",
    "plugin.state.write",
    "events.subscribe",
    "events.emit",
    "jobs.schedule",
    "webhooks.receive",
    "http.outbound",
    "secrets.read-ref",
    "agent.tools.register",
    "instance.settings.register",
    "ui.page.register",
    "ui.dashboardWidget.register",
    "ui.detailTab.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      githubTokenSecretRef: {
        type: "string",
        title: "GitHub Token Secret Reference",
        description:
          "Secret reference for a GitHub Personal Access Token (PAT) with repo scope. Create the secret in Paperclip first, then enter its reference here.",
      },
      autoCloneOnWorkspaceResolve: {
        type: "boolean",
        title: "Auto-Clone Connected Repos",
        description:
          "Automatically clone connected repos into agent workspaces. Only repos you explicitly connect will be cloned.",
        default: DEFAULT_CONFIG.autoCloneOnWorkspaceResolve,
      },
      autoCreateProjects: {
        type: "boolean",
        title: "Auto-Create Projects from Connected Repos",
        description:
          "When connecting a repo, automatically create a Paperclip project and workspace for it if one doesn't exist.",
        default: DEFAULT_CONFIG.autoCreateProjects,
      },
      syncIssuesEnabled: {
        type: "boolean",
        title: "Sync GitHub Issues",
        description: "Periodically sync GitHub issues into Paperclip issues.",
        default: DEFAULT_CONFIG.syncIssuesEnabled,
      },
      syncIntervalMinutes: {
        type: "number",
        title: "Sync Interval (minutes)",
        default: DEFAULT_CONFIG.syncIntervalMinutes,
        minimum: 5,
        maximum: 1440,
      },
      defaultBranch: {
        type: "string",
        title: "Default Branch",
        default: DEFAULT_CONFIG.defaultBranch,
      },
    },
    required: [],
  },
  jobs: [
    {
      jobKey: JOB_KEYS.syncRepos,
      displayName: "Sync Repos to Workspaces",
      description:
        "Ensures all project workspaces with a repo_url have a local clone available.",
      schedule: "*/10 * * * *",
    },
    {
      jobKey: JOB_KEYS.syncIssues,
      displayName: "Sync GitHub Issues",
      description: "Fetches open GitHub issues and syncs them to Paperclip.",
      schedule: "*/30 * * * *",
    },
  ],
  webhooks: [
    {
      endpointKey: WEBHOOK_KEYS.githubEvent,
      displayName: "GitHub Webhook",
      description:
        "Receives push, pull_request, and issues events from GitHub.",
    },
  ],
  tools: [
    {
      name: TOOL_NAMES.cloneRepo,
      displayName: "Clone GitHub Repo",
      description:
        "Clones a GitHub repository into the agent workspace. If already cloned, pulls latest changes.",
      parametersSchema: {
        type: "object",
        properties: {
          repoUrl: {
            type: "string",
            description: "GitHub repo URL (e.g. https://github.com/owner/repo)",
          },
          branch: {
            type: "string",
            description: "Branch to checkout (default: main)",
          },
          targetDir: {
            type: "string",
            description: "Target directory name within workspace",
          },
        },
        required: ["repoUrl"],
      },
    },
    {
      name: TOOL_NAMES.listRepos,
      displayName: "List GitHub Repos",
      description: "Lists repositories for the authenticated GitHub user or a specified org.",
      parametersSchema: {
        type: "object",
        properties: {
          org: {
            type: "string",
            description: "GitHub organization name. If omitted, lists user repos.",
          },
          limit: {
            type: "number",
            description: "Max repos to return (default: 30)",
          },
        },
      },
    },
    {
      name: TOOL_NAMES.searchIssues,
      displayName: "Search GitHub Issues",
      description: "Searches GitHub issues and PRs using the GitHub search API.",
      parametersSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "GitHub search query (e.g. 'is:open label:bug repo:owner/name')",
          },
          repo: {
            type: "string",
            description: "Scope search to a specific repo (owner/name)",
          },
          limit: {
            type: "number",
            description: "Max results to return (default: 20)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: TOOL_NAMES.createPr,
      displayName: "Create Pull Request",
      description: "Creates a pull request on GitHub.",
      parametersSchema: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "Repository (owner/name)",
          },
          title: { type: "string" },
          body: { type: "string" },
          head: {
            type: "string",
            description: "Branch containing changes",
          },
          base: {
            type: "string",
            description: "Branch to merge into (default: main)",
          },
        },
        required: ["repo", "title", "head"],
      },
    },
    {
      name: TOOL_NAMES.getFileContents,
      displayName: "Get File Contents",
      description: "Reads a file from a GitHub repository via the API.",
      parametersSchema: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "Repository (owner/name)",
          },
          path: {
            type: "string",
            description: "File path within the repo",
          },
          ref: {
            type: "string",
            description: "Branch, tag, or commit SHA (default: main)",
          },
        },
        required: ["repo", "path"],
      },
    },
    {
      name: TOOL_NAMES.listBranches,
      displayName: "List Branches",
      description: "Lists branches for a GitHub repository.",
      parametersSchema: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "Repository (owner/name)",
          },
          limit: {
            type: "number",
            description: "Max branches to return (default: 30)",
          },
        },
        required: ["repo"],
      },
    },
    {
      name: TOOL_NAMES.createRepo,
      displayName: "Create GitHub Repository",
      description: "Creates a new GitHub repository in a user account or organization.",
      parametersSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Repository name",
          },
          org: {
            type: "string",
            description: "Organization to create the repo in. If omitted, creates under your user account.",
          },
          description: {
            type: "string",
            description: "Repository description",
          },
          private: {
            type: "boolean",
            description: "Whether the repo should be private (default: true)",
          },
        },
        required: ["name"],
      },
    },
  ],
  ui: {
    slots: [
      {
        type: "page",
        id: SLOT_IDS.page,
        displayName: "GitHub",
        exportName: EXPORT_NAMES.page,
        routePath: PAGE_ROUTE,
      },
      {
        type: "settingsPage",
        id: SLOT_IDS.settingsPage,
        displayName: "GitHub Settings",
        exportName: EXPORT_NAMES.settingsPage,
      },
      {
        type: "dashboardWidget",
        id: SLOT_IDS.dashboardWidget,
        displayName: "GitHub",
        exportName: EXPORT_NAMES.dashboardWidget,
      },
      {
        type: "detailTab",
        id: SLOT_IDS.projectTab,
        displayName: "GitHub",
        exportName: EXPORT_NAMES.projectTab,
        entityTypes: ["project"],
      },
      {
        type: "detailTab",
        id: SLOT_IDS.issueTab,
        displayName: "GitHub",
        exportName: EXPORT_NAMES.issueTab,
        entityTypes: ["issue"],
      },
    ],
  },
};

export default manifest;
