import * as p from "@clack/prompts";
import pc from "picocolors";
import { resolveCommandContext, handleCommandError, type BaseClientOptions } from "./client/common.js";

interface SetupOptions extends BaseClientOptions {
  repoUrl?: string;
  adapterType?: string;
  model?: string;
  budget?: string;
  ceoId?: string;
}

interface Agent {
  id: string;
  name: string;
  role: string;
  companyId: string;
}

interface Project {
  id: string;
  name: string;
}

export async function setupPlatformEngineer(opts: SetupOptions) {
  try {
    const { api, companyId } = resolveCommandContext(opts, { requireCompany: true });

    if (!companyId) {
      p.log.error("Company ID is required. Pass --company-id or set PAPERCLIP_COMPANY_ID.");
      process.exit(1);
    }

    p.intro(pc.bgCyan(pc.black(" Setup Platform Engineer ")));

    // --- Step 1: Find or validate the CEO / manager agent ---
    let managerId = opts.ceoId?.trim() || null;
    if (!managerId) {
      p.log.step("Looking for CEO agent to set as manager...");
      const agents = await api.get<Agent[]>(`/api/companies/${companyId}/agents`);
      const ceo = agents?.find((a) => a.role === "ceo");
      if (ceo) {
        managerId = ceo.id;
        p.log.info(`Found CEO: ${pc.cyan(ceo.name)} (${ceo.id})`);
      } else {
        p.log.warn("No CEO agent found. Platform Engineer will have no manager.");
      }
    }

    // --- Step 2: Create the "Paperclip Platform" project ---
    p.log.step("Creating Paperclip Platform project...");

    const repoUrl = opts.repoUrl?.trim() || "https://github.com/tarikstafford/claw-paper-clip.git";
    const adapterType = opts.adapterType?.trim() || "opencode_local";
    const model = opts.model?.trim() || "";
    const budgetCents = Math.max(0, Number(opts.budget ?? "10000"));

    const project = await api.post<Project>(`/api/companies/${companyId}/projects`, {
      name: "Paperclip Platform",
      description: "Internal project for Paperclip platform development, bug fixes, and improvements.",
      status: "active",
      executionWorkspacePolicy: {
        enabled: true,
        defaultMode: "isolated",
        allowIssueOverride: true,
        workspaceStrategy: {
          type: "git_worktree",
          baseRef: "origin/master",
          branchTemplate: "{{issue.identifier}}-{{slug}}",
        },
      },
      workspace: {
        name: "Paperclip Repo",
        repoUrl,
        repoRef: "master",
        isPrimary: true,
      },
    });

    if (!project) {
      p.log.error("Failed to create project.");
      process.exit(1);
    }

    p.log.success(`Project created: ${pc.cyan(project.name)} (${project.id})`);

    // --- Step 3: Create the Platform Engineer agent ---
    p.log.step("Creating Platform Engineer agent...");

    const adapterConfig: Record<string, unknown> = {
      instructionsFilePath: "agents/platform-engineer/INSTRUCTIONS.md",
    };
    if (model) {
      adapterConfig.model = model;
    }

    const agent = await api.post<Agent>(`/api/companies/${companyId}/agents`, {
      name: "Platform Engineer",
      role: "engineer",
      title: "Platform Engineer",
      icon: "terminal",
      reportsTo: managerId,
      capabilities: "Fix bugs, add features, and improve the Paperclip platform. Works on the claw-paper-clip codebase. Creates PRs for all changes — never pushes to main directly.",
      adapterType,
      adapterConfig,
      runtimeConfig: {},
      budgetMonthlyCents: budgetCents,
    });

    if (!agent) {
      p.log.error("Failed to create agent.");
      process.exit(1);
    }

    p.log.success(`Agent created: ${pc.cyan(agent.name)} (${agent.id})`);

    // --- Summary ---
    p.note(
      [
        `${pc.bold("Project:")} ${project.name} (${project.id})`,
        `${pc.bold("Agent:")} ${agent.name} (${agent.id})`,
        `${pc.bold("Role:")} engineer`,
        `${pc.bold("Adapter:")} ${adapterType}`,
        `${pc.bold("Repo:")} ${repoUrl}`,
        `${pc.bold("Workspace:")} git_worktree (branch per issue)`,
        `${pc.bold("Manager:")} ${managerId ?? "none"}`,
        `${pc.bold("Budget:")} $${(budgetCents / 100).toFixed(2)}/month`,
        "",
        `${pc.dim("The agent will create PRs for all changes.")}`,
        `${pc.dim("You (the board) review and merge, then deploy.")}`,
      ].join("\n"),
      "Platform Engineer Setup Complete",
    );

    p.log.message("");
    p.log.message(`To assign work: create issues in the "${pc.cyan("Paperclip Platform")}" project`);
    p.log.message(`To trigger manually: ${pc.cyan(`paperclipai heartbeat run -a ${agent.id}`)}`);

    p.outro("Done!");
  } catch (err) {
    handleCommandError(err);
  }
}
