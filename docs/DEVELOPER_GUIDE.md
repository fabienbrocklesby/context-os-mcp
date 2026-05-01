# Developer Guide

This guide is for someone opening the repo for the first time.

## Local Setup

```bash
npm install
npm run typecheck
npm test
```

Create local config:

```bash
cp wrangler.example.jsonc wrangler.jsonc
cp .env.example .dev.vars
```

Fill in Cloudflare, Zoho, and GitHub values before running a real Worker.

## Useful Commands

```bash
npm run dev
npm run typecheck
npm test
npm run deploy
```

Apply D1 migrations:

```bash
npx wrangler d1 migrations apply <database-name> --local
npx wrangler d1 migrations apply <database-name> --remote
```

## Important Paths

- `src/index.ts`: Worker entrypoint, routes, queue, cron.
- `src/mcp/tools.ts`: MCP tool registrations and input schemas.
- `src/domain/service.ts`: application orchestration.
- `src/domain/memory.ts`: domain types and schemas.
- `src/persistence/d1/repository.ts`: D1 persistence.
- `src/integrations/zoho/client.ts`: Zoho WorkDrive API client.
- `src/integrations/github/client.ts`: GitHub API client.
- `src/integrations/vectorize/client.ts`: Vectorize adapter.
- `migrations/`: D1 schema migrations.

## Local Files Not For GitHub

- `.dev.vars`: local secrets.
- `wrangler.jsonc`: account-specific Cloudflare resource IDs.
- `backups/`: local production exports.
- `.wrangler*/`: generated Wrangler state.
- `src/worker-configuration.d.ts`: generated Worker types.

Use `wrangler.example.jsonc` and `.env.example` as publishable templates.

## Testing Philosophy

Unit tests cover parsing, chunking, ranking, and project provisioning.

Integration-style tests mock provider boundaries for Zoho, Vectorize, and indexing orchestration.

Contract tests verify the MCP tool surface and OpenAI-compatible `search` / `fetch` behavior.

Live Cloudflare, Zoho, GitHub, and MCP client testing is an operational deployment step, not something the local test suite can prove by itself.
