CREATE TABLE IF NOT EXISTS client_environments (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  default_tool_style TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_capabilities (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  source_of_truth INTEGER NOT NULL DEFAULT 0,
  volatile INTEGER NOT NULL DEFAULT 0,
  sensitivity TEXT NOT NULL DEFAULT 'internal',
  requires_confirmation INTEGER NOT NULL DEFAULT 0,
  destructive INTEGER NOT NULL DEFAULT 0,
  save_policy TEXT NOT NULL DEFAULT 'durable_summary',
  instructions_markdown TEXT,
  input_hints_json TEXT NOT NULL DEFAULT '{}',
  output_hints_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS environment_capabilities (
  id TEXT PRIMARY KEY,
  environment_slug TEXT NOT NULL,
  capability_slug TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT 'unknown',
  invocation_style TEXT NOT NULL DEFAULT 'manual_instruction',
  tool_name TEXT,
  usage_instructions_markdown TEXT,
  limitations_markdown TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(environment_slug, capability_slug),
  FOREIGN KEY (environment_slug) REFERENCES client_environments(slug),
  FOREIGN KEY (capability_slug) REFERENCES tool_capabilities(slug)
);

CREATE TABLE IF NOT EXISTS migration_audit_events (
  id TEXT PRIMARY KEY,
  migration_slug TEXT NOT NULL,
  phase TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  counts_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

ALTER TABLE projects ADD COLUMN canonical_project TEXT;
ALTER TABLE projects ADD COLUMN merged_into_project TEXT;
ALTER TABLE projects ADD COLUMN noncanonical_reason TEXT;
ALTER TABLE projects ADD COLUMN canonical_status TEXT NOT NULL DEFAULT 'canonical';
ALTER TABLE projects ADD COLUMN canonical_updated_at TEXT;

ALTER TABLE documents ADD COLUMN canonical_group TEXT;
ALTER TABLE documents ADD COLUMN noncanonical_reason TEXT;
ALTER TABLE documents ADD COLUMN migration_notes_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_client_environments_slug ON client_environments(slug);
CREATE INDEX IF NOT EXISTS idx_tool_capabilities_source_action ON tool_capabilities(source_kind, action_kind);
CREATE INDEX IF NOT EXISTS idx_environment_capabilities_env_priority ON environment_capabilities(environment_slug, availability, priority);
CREATE INDEX IF NOT EXISTS idx_migration_audit_events_slug_phase ON migration_audit_events(migration_slug, phase, created_at);
CREATE INDEX IF NOT EXISTS idx_projects_canonical_status ON projects(canonical_status, merged_into_project);
CREATE INDEX IF NOT EXISTS idx_documents_canonical_group ON documents(project, canonical_group, active);

INSERT OR IGNORE INTO client_environments (
  id, slug, display_name, description, default_tool_style, notes, created_at, updated_at
) VALUES
  ('env-claude', 'claude', 'Claude', 'Claude desktop/web or MCP-capable Claude environment.', 'mcp_tool', 'Call ContextOS first, then use available MCP/connectors directly.', datetime('now'), datetime('now')),
  ('env-chatgpt', 'chatgpt', 'ChatGPT', 'ChatGPT, custom GPT, or OpenAI app/tool environment.', 'chatgpt_app', 'Call ContextOS first, then follow app/connector/tool instructions.', datetime('now'), datetime('now')),
  ('env-codex', 'codex', 'Codex', 'Codex CLI/app coding environment with terminal and optional plugins.', 'terminal_command', 'Use local repo/terminal/GitHub/Cloudflare tools when available and record durable summaries.', datetime('now'), datetime('now')),
  ('env-generic-mcp', 'generic_mcp', 'Generic MCP Client', 'Any MCP client with unknown host-specific tool conventions.', 'mcp_tool', 'Prefer MCP tool calls and degrade explicitly when tools are unavailable.', datetime('now'), datetime('now')),
  ('env-local-cli', 'local_cli', 'Local CLI', 'Local command-line environment.', 'terminal_command', 'Use terminal commands for local/live checks where configured.', datetime('now'), datetime('now')),
  ('env-other', 'other', 'Other', 'Unknown or manually described AI client environment.', 'manual_instruction', 'Return conservative instructions and unavailable-tool warnings.', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO tool_capabilities (
  id, slug, display_name, source_kind, action_kind, source_of_truth, volatile,
  sensitivity, requires_confirmation, destructive, save_policy,
  instructions_markdown, input_hints_json, output_hints_json, created_at, updated_at
) VALUES
  ('cap-contextos-memory', 'contextos_memory', 'ContextOS Memory', 'memory', 'search', 1, 0, 'internal', 0, 0, 'durable_summary', 'Use prepare_assistant_session first, then search_memory/get_current_context for deeper recall.', '{}', '{}', datetime('now'), datetime('now')),
  ('cap-github-live', 'github_live', 'GitHub Live Repo', 'github', 'inspect', 1, 1, 'internal', 0, 0, 'durable_summary', 'Use GitHub search/file tools for live repository state before making code claims.', '{}', '{}', datetime('now'), datetime('now')),
  ('cap-workdrive-live', 'workdrive_live', 'WorkDrive Canonical Memory', 'workdrive', 'read', 1, 1, 'confidential', 0, 0, 'durable_summary', 'Treat WorkDrive Markdown as canonical durable memory; store summaries and links unless raw content is approved.', '{}', '{}', datetime('now'), datetime('now')),
  ('cap-zoho-crm-live', 'zoho_crm_live', 'Zoho CRM Live Data', 'zoho_crm', 'read', 1, 1, 'confidential', 0, 0, 'durable_summary', 'Check live CRM before account, customer, or deal recommendations.', '{}', '{}', datetime('now'), datetime('now')),
  ('cap-zoho-mail-live', 'zoho_mail_live', 'Zoho Mail Live Threads', 'zoho_mail', 'read', 1, 1, 'sensitive', 0, 0, 'requires_approval', 'Keep raw email live-only; save only user-approved thread summaries, commitments, and decisions.', '{}', '{}', datetime('now'), datetime('now')),
  ('cap-calendar-live', 'calendar_live', 'Calendar Live Availability', 'calendar', 'read', 1, 1, 'confidential', 0, 0, 'durable_summary', 'Check calendar availability before dated commitments or scheduling claims.', '{}', '{}', datetime('now'), datetime('now')),
  ('cap-shopify-live', 'shopify_live', 'Shopify Live Store', 'shopify', 'read', 1, 1, 'confidential', 0, 0, 'durable_summary', 'Check live product/order/inventory state before ecommerce recommendations.', '{}', '{}', datetime('now'), datetime('now')),
  ('cap-cloudflare-live', 'cloudflare_live', 'Cloudflare Live Platform', 'cloudflare', 'deploy', 1, 1, 'internal', 1, 1, 'durable_summary', 'Use Wrangler/API for D1, Vectorize, Workers, and deploy checks; require confirmation for destructive operations.', '{}', '{}', datetime('now'), datetime('now')),
  ('cap-terminal-local', 'terminal_local', 'Local Terminal', 'terminal', 'execute', 1, 1, 'internal', 1, 0, 'durable_summary', 'Use local terminal for repo inspection, tests, builds, and safe CLI checks.', '{}', '{}', datetime('now'), datetime('now')),
  ('cap-memory-migration', 'memory_migration', 'Memory Migration/Reconciliation', 'memory', 'migrate', 0, 0, 'internal', 1, 0, 'durable_summary', 'Analyze first. Apply only idempotent metadata-safe reconciliation; never delete memory.', '{}', '{}', datetime('now'), datetime('now')),
  ('cap-durable-writeback', 'durable_writeback', 'Durable Write-Back', 'memory', 'write', 0, 0, 'internal', 1, 0, 'durable_summary', 'Use finish_work_session, record_decision, save_source_event, upsert_task, and link_memory for concise durable summaries.', '{}', '{}', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO environment_capabilities (
  id, environment_slug, capability_slug, availability, invocation_style, tool_name,
  usage_instructions_markdown, limitations_markdown, priority, created_at, updated_at
) VALUES
  ('ec-codex-memory', 'codex', 'contextos_memory', 'available', 'mcp_tool', 'memory.prepare_assistant_session', 'Call ContextOS memory first; if MCP names are unavailable use ~/.codex/bin/memory-mcp.', NULL, 10, datetime('now'), datetime('now')),
  ('ec-codex-terminal', 'codex', 'terminal_local', 'available', 'terminal_command', 'terminal', 'Use terminal for local repo inspection, tests, Wrangler, and safe smoke checks.', 'Do not print secrets or run destructive commands without explicit approval.', 20, datetime('now'), datetime('now')),
  ('ec-codex-github', 'codex', 'github_live', 'user_configured', 'connector', 'github', 'Use GitHub plugin or gh when configured; otherwise rely on local checkout and say live GitHub was not checked.', NULL, 30, datetime('now'), datetime('now')),
  ('ec-codex-cloudflare', 'codex', 'cloudflare_live', 'user_configured', 'terminal_command', 'wrangler', 'Use Wrangler with non-interactive auth for D1/Vectorize/deploy checks.', 'Requires CLOUDFLARE_API_TOKEN or logged-in Wrangler auth.', 40, datetime('now'), datetime('now')),
  ('ec-claude-memory', 'claude', 'contextos_memory', 'available', 'mcp_tool', 'prepare_assistant_session', 'Call ContextOS first, then follow returned live-check instructions.', NULL, 10, datetime('now'), datetime('now')),
  ('ec-chatgpt-memory', 'chatgpt', 'contextos_memory', 'available', 'mcp_tool', 'prepare_assistant_session', 'Call ContextOS first, then use available apps/connectors/tools as instructed.', NULL, 10, datetime('now'), datetime('now')),
  ('ec-generic-memory', 'generic_mcp', 'contextos_memory', 'available', 'mcp_tool', 'prepare_assistant_session', 'Call prepare_assistant_session first and report unavailable host tools explicitly.', NULL, 10, datetime('now'), datetime('now')),
  ('ec-local-memory', 'local_cli', 'contextos_memory', 'available', 'terminal_command', 'memory-mcp', 'Use the local memory-mcp CLI wrapper when MCP tools are unavailable.', NULL, 10, datetime('now'), datetime('now'));
