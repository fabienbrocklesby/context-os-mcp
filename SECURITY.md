# Security

This project handles private memory, OAuth tokens, and business context. Treat every deployment as sensitive infrastructure.

## Do Not Commit

- `.dev.vars`
- `wrangler.jsonc` with real account/resource IDs
- production D1 exports
- OAuth client secrets
- Zoho refresh/access tokens
- bearer tokens
- private customer, email, calendar, or CRM payloads

## Reporting

If you find a security issue in a private deployment, rotate exposed credentials first, then patch the deployment.

For public forks, open a private advisory or contact the maintainer through the repository owner profile.

## Operational Guidance

- Prefer OAuth for user-facing clients.
- Use `MCP_BEARER_TOKEN` only for trusted service-style clients.
- Keep admin tools restricted with `ADMIN_GITHUB_LOGINS`.
- Use connector policies to prevent raw private external data from being stored as durable memory.
- Back up D1 before production migrations.
