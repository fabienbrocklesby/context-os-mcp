import { z } from "zod";

const envSchema = z.object({
  APP_BASE_URL: z.string().url(),
  MCP_ROUTE: z.string().default("/mcp"),
  ALLOWED_ORIGINS: z.string().optional(),
  MCP_BEARER_TOKEN: z.string().optional(),
  MCP_EXTRA_BEARER_TOKENS: z.string().optional(),
  ADMIN_GITHUB_LOGINS: z.string().optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITHUB_OAUTH_AUTHORIZE_URL: z.string().url(),
  GITHUB_OAUTH_TOKEN_URL: z.string().url(),
  GITHUB_OAUTH_USER_URL: z.string().url(),
  GITHUB_OAUTH_EMAILS_URL: z.string().url(),
  GITHUB_API_BASE_URL: z.string().url().default("https://api.github.com"),
  GITHUB_OAUTH_SCOPES: z.string().default("read:user user:email repo"),
  GITHUB_ACCESS_TOKEN: z.string().optional(),
  GITHUB_ALLOWED_REPOS: z.string().optional(),
  ZOHO_ACCOUNTS_BASE_URL: z.string().url(),
  ZOHO_WORKDRIVE_API_BASE_URL: z.string().url(),
  ZOHO_WORKDRIVE_UPLOAD_URL: z.string().url().optional(),
  ZOHO_CLIENT_ID: z.string().optional(),
  ZOHO_CLIENT_SECRET: z.string().optional(),
  ZOHO_REFRESH_TOKEN: z.string().optional(),
  ZOHO_ACCESS_TOKEN: z.string().optional(),
  WORKERS_AI_EMBEDDING_MODEL: z.string().default("@cf/baai/bge-base-en-v1.5"),
  WORKDRIVE_SHARED_ROOT_FOLDER_ID: z.string().optional(),
  WORKDRIVE_PROJECTS_ROOT_FOLDER_ID: z.string().optional(),
  DEFAULT_TIMEZONE: z.string().optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: Env) {
  const parsed = envSchema.parse(env);
  return {
    appBaseUrl: parsed.APP_BASE_URL,
    mcpRoute: parsed.MCP_ROUTE,
    allowedOrigins: splitCsv(parsed.ALLOWED_ORIGINS),
    bearerToken: parsed.MCP_BEARER_TOKEN,
    extraBearerTokens: splitCsv(parsed.MCP_EXTRA_BEARER_TOKENS),
    adminGithubLogins: new Set(splitCsv(parsed.ADMIN_GITHUB_LOGINS)),
    sessionSecret: parsed.SESSION_SECRET,
    github: {
      clientId: parsed.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: parsed.GITHUB_OAUTH_CLIENT_SECRET,
      authorizeUrl: parsed.GITHUB_OAUTH_AUTHORIZE_URL,
      tokenUrl: parsed.GITHUB_OAUTH_TOKEN_URL,
      userUrl: parsed.GITHUB_OAUTH_USER_URL,
      emailsUrl: parsed.GITHUB_OAUTH_EMAILS_URL,
      apiBaseUrl: parsed.GITHUB_API_BASE_URL,
      oauthScopes: splitCsv(parsed.GITHUB_OAUTH_SCOPES.replaceAll(" ", ",")),
      accessToken: parsed.GITHUB_ACCESS_TOKEN,
      allowedRepos: splitCsv(parsed.GITHUB_ALLOWED_REPOS).map((repo) => repo.toLowerCase()),
    },
    zoho: {
      accountsBaseUrl: parsed.ZOHO_ACCOUNTS_BASE_URL,
      apiBaseUrl: parsed.ZOHO_WORKDRIVE_API_BASE_URL,
      uploadUrl: parsed.ZOHO_WORKDRIVE_UPLOAD_URL,
      clientId: parsed.ZOHO_CLIENT_ID,
      clientSecret: parsed.ZOHO_CLIENT_SECRET,
      refreshToken: parsed.ZOHO_REFRESH_TOKEN,
      accessToken: parsed.ZOHO_ACCESS_TOKEN,
      sharedRootFolderId: parsed.WORKDRIVE_SHARED_ROOT_FOLDER_ID,
      projectsRootFolderId: parsed.WORKDRIVE_PROJECTS_ROOT_FOLDER_ID,
    },
    workersAiEmbeddingModel: parsed.WORKERS_AI_EMBEDDING_MODEL,
    defaultTimezone: parsed.DEFAULT_TIMEZONE,
  };
}

function splitCsv(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
