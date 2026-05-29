import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { loadConfig } from "~/config/env";
import type { MemoryPrincipal } from "~/domain/memory";
import { MemoryService } from "~/domain/service";
import { GithubOAuthClient } from "~/integrations/github/client";
import { ZohoWorkDriveClient } from "~/integrations/zoho/client";
import { DocumentRepository } from "~/persistence/d1/DocumentRepository";
import { EntityRepository } from "~/persistence/d1/EntityRepository";
import { InitiativeRepository } from "~/persistence/d1/InitiativeRepository";
import { ProjectRepository } from "~/persistence/d1/ProjectRepository";
import { DocumentService } from "~/service/DocumentService";
import { EntityService } from "~/service/EntityService";
import { InitiativeService } from "~/service/InitiativeService";
import { PlanningService } from "~/service/PlanningService";
import { ProjectService } from "~/service/ProjectService";
import { RetrievalService } from "~/service/RetrievalService";
import { registerAdminTools } from "~/tools/admin-tools";
import { registerGithubTools } from "~/tools/github-tools";
import { registerInitiativeTools } from "~/tools/initiative-tools";
import { registerMemoryTools } from "~/tools/memory-tools";
import { registerPlanningTools } from "~/tools/planning-tools";
import { registerProjectTools } from "~/tools/project-tools";
import { registerRetrievalTools } from "~/tools/retrieval-tools";

export function createMemoryMcpServer(env: Env, principal: MemoryPrincipal) {
  const server = new McpServer({ name: "context-os-memory", version: "0.1.0" });
  const config = loadConfig(env);

  // Repositories
  const projectRepo = new ProjectRepository(env.DB);
  const docRepo = new DocumentRepository(env.DB);
  const entityRepo = new EntityRepository(env.DB);
  const initiativeRepo = new InitiativeRepository(env.DB);

  // Integrations
  const zoho = new ZohoWorkDriveClient(env);
  const github = new GithubOAuthClient(env, config.github, principal);

  // Services
  const projectSvc = new ProjectService(env, principal, projectRepo, docRepo, zoho, config);
  const initiativeSvc = new InitiativeService(env, principal, initiativeRepo, projectRepo, entityRepo);
  const entitySvc = new EntityService(env, principal, entityRepo, projectRepo);
  const retrievalSvc = new RetrievalService(env, principal, projectRepo, docRepo, entityRepo, initiativeRepo);
  const docSvc = new DocumentService(env, principal, projectRepo, docRepo, entityRepo, config, zoho, github);
  const planningSvc = new PlanningService(
    env, principal, projectRepo, docRepo, entityRepo, initiativeRepo,
    retrievalSvc, initiativeSvc, docSvc, config,
  );

  // Legacy service for migration tools not yet extracted
  const legacySvc = new MemoryService(env, principal);

  // Register tool groups
  registerProjectTools(server, projectSvc);
  registerGithubTools(server, projectSvc, docSvc);
  registerPlanningTools(server, planningSvc, docSvc);
  registerRetrievalTools(server, retrievalSvc, docSvc);
  registerMemoryTools(server, entitySvc, docSvc);
  registerInitiativeTools(server, initiativeSvc);
  registerAdminTools(server, docSvc, legacySvc);

  return server;
}
