# Contributing

Context OS MCP is early, production-oriented infrastructure. Changes should preserve existing memory data and keep client compatibility in mind.

## Before Changing Code

Run:

```bash
npm install
npm run typecheck
npm test
```

Read:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPER_GUIDE.md`
- `docs/DEPLOYMENT_AND_OPERATIONS.md`

## Development Rules

- Keep D1 migrations additive whenever possible.
- Do not delete or rewrite existing memory data in migrations.
- Preserve compatibility for `prepare_work_session`.
- Prefer structured memory writes over large copied external payloads.
- Keep external systems live-first and memory selective.
- Add tests for new tool schemas, persistence behavior, retrieval behavior, or connector policies.

## Pull Request Checklist

- Typecheck passes.
- Tests pass.
- New tools or schema changes are documented.
- Migrations are safe for existing production data.
- Sensitive values are not committed.
