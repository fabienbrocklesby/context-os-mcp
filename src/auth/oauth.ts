import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { loadConfig } from "~/config/env";
import type { MemoryPrincipal } from "~/domain/memory";
import { githubAccessTokenKey } from "~/integrations/github/client";
import { serveAuthenticatedMcpRequest } from "~/mcp/server";
import {
  createClearedCookieHeader,
  createSetCookieHeader,
  decodeSignedCookie,
  encodeSignedCookie,
  getAuthorizeCsrfCookieName,
  getGithubStateCookieName,
  getSessionCookieName,
  readCookie,
  readSessionFromRequest,
} from "~/auth/session";

type GithubStatePayload = {
  state: string;
  returnTo: string;
};

type GithubUser = {
  id: number;
  login: string;
  name?: string | null;
};

type GithubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};

export const oauthProvider = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: {
    fetch: async (request, env, ctx) => {
      const principal = ((ctx as ExecutionContext & { props?: MemoryPrincipal }).props ?? {
        authType: "oauth",
        userId: "unknown",
        login: "unknown",
      }) as MemoryPrincipal;
      return serveAuthenticatedMcpRequest(request, env as Env, ctx as ExecutionContext, principal);
    },
  },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  defaultHandler: {
    fetch: handleOAuthDefaultRequest,
  },
  scopesSupported: ["memory.read", "memory.write", "memory.admin"],
  allowPlainPKCE: false,
  accessTokenTTL: 3600,
  refreshTokenTTL: 2_592_000,
  clientIdMetadataDocumentEnabled: true,
});

async function handleOAuthDefaultRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  const config = loadConfig(env);
  const session = await readSessionFromRequest(request, config.sessionSecret);

  if (url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  if (url.pathname === "/logout") {
    if (session) {
      await env.OAUTH_KV.delete(githubAccessTokenKey(session.userId));
    }
    return new Response("Logged out", {
      headers: {
        "set-cookie": createClearedCookieHeader(getSessionCookieName(), cookieOptions(config)),
      },
    });
  }

  if (url.pathname === "/login/github") {
    return startGithubLogin(request, env);
  }

  if (url.pathname === "/auth/github/callback") {
    return handleGithubCallback(request, env);
  }

  if (url.pathname === "/github/connected") {
    return renderGithubConnected(env, session);
  }

  if (url.pathname === "/authorize" && request.method === "GET") {
    return renderAuthorizePage(request, env, session);
  }

  if (url.pathname === "/authorize" && request.method === "POST") {
    return completeAuthorize(request, env, session);
  }

  if (url.pathname === "/") {
    return new Response(
      "memory-system-mcp is running. Use /mcp for the MCP endpoint.",
      {
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      },
    );
  }

  return new Response("Not found", { status: 404 });
}

async function startGithubLogin(request: Request, env: Env) {
  const config = loadConfig(env);
  requireGithubConfig(config);
  const returnTo =
    new URL(request.url).searchParams.get("return_to") ??
    `${config.appBaseUrl}/github/connected`;
  const state = crypto.randomUUID();
  const stateCookie = await encodeSignedCookie<GithubStatePayload>(
    { state, returnTo },
    config.sessionSecret!,
  );
  const redirectUri = new URL("/auth/github/callback", config.appBaseUrl).toString();
  const authorizeUrl = new URL(config.github.authorizeUrl);
  authorizeUrl.searchParams.set("client_id", config.github.clientId!);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", config.github.oauthScopes.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("allow_signup", "false");

  return redirectWithHeaders(authorizeUrl.toString(), {
    "set-cookie": createSetCookieHeader(getGithubStateCookieName(), stateCookie, {
      ...cookieOptions(config),
      maxAge: 600,
    }),
  });
}

async function handleGithubCallback(request: Request, env: Env) {
  const config = loadConfig(env);
  requireGithubConfig(config);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return new Response("Missing GitHub OAuth callback parameters.", { status: 400 });
  }

  const storedState = await decodeSignedCookie<GithubStatePayload>(
    readCookie(request, getGithubStateCookieName()),
    config.sessionSecret!,
  );
  if (!storedState || storedState.state !== state) {
    return new Response("Invalid GitHub OAuth state.", { status: 400 });
  }

  const accessToken = await exchangeGithubCodeForToken(code, config);
  const user = await fetchGithubUser(accessToken, config);
  const emails = await fetchGithubEmails(accessToken, config);
  const primaryEmail = emails.find((email) => email.primary && email.verified)?.email;
  const principal: MemoryPrincipal = {
    authType: "oauth",
    userId: String(user.id),
    login: user.login,
    email: primaryEmail,
    displayName: user.name ?? user.login,
  };
  await env.OAUTH_KV.put(githubAccessTokenKey(principal.userId), accessToken);
  await env.OAUTH_KV.put("github:default_user_id", principal.userId);
  await env.OAUTH_KV.put("github:default_login", principal.login);

  const sessionCookie = await encodeSignedCookie(principal, config.sessionSecret!);
  return redirectWithCookies(storedState.returnTo, [
      createSetCookieHeader(getSessionCookieName(), sessionCookie, cookieOptions(config)),
      createClearedCookieHeader(getGithubStateCookieName(), cookieOptions(config)),
  ]);
}

async function renderGithubConnected(env: Env, session: MemoryPrincipal | null) {
  const login = session?.login ?? (await env.OAUTH_KV.get("github:default_login"));
  if (!login) {
    return new Response(
      "GitHub is not connected yet. Visit /login/github to connect your account.",
      {
        status: 401,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      },
    );
  }

  return new Response(
    `GitHub connected as ${login}. You can close this tab and use the memory MCP GitHub tools.`,
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    },
  );
}

async function renderAuthorizePage(
  request: Request,
  env: Env,
  session: MemoryPrincipal | null,
) {
  const config = loadConfig(env);
  if (!session) {
    return Response.redirect(
      `${config.appBaseUrl}/login/github?return_to=${encodeURIComponent(request.url)}`,
      302,
    );
  }

  const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const clientInfo = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  const csrf = crypto.randomUUID();

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorize memory-system-mcp</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 42rem; line-height: 1.5; color: #111827; }
      .card { border: 1px solid #d1d5db; border-radius: 12px; padding: 1.5rem; }
      button { background: #111827; border: none; border-radius: 999px; color: white; cursor: pointer; padding: 0.8rem 1.2rem; }
      .secondary { background: white; border: 1px solid #d1d5db; color: #111827; }
      .actions { display: flex; gap: 0.75rem; margin-top: 1rem; }
      code { background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 4px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Authorize memory-system-mcp</h1>
      <p>Signed in as <strong>${escapeHtml(session.login)}</strong>${session.email ? ` (${escapeHtml(session.email)})` : ""}.</p>
      <p>Client <code>${escapeHtml(clientInfo?.clientName ?? authRequest.clientId)}</code> is requesting access to your shared AI memory MCP server.</p>
      <p>Requested scopes: <code>${escapeHtml(authRequest.scope.join(" "))}</code></p>
      <form method="post" action="/authorize">
        <input type="hidden" name="csrf" value="${csrf}" />
        <input type="hidden" name="auth_query" value="${escapeHtml(new URL(request.url).searchParams.toString())}" />
        <div class="actions">
          <button type="submit" name="decision" value="approve">Approve</button>
          <button class="secondary" type="submit" name="decision" value="deny">Deny</button>
        </div>
      </form>
    </div>
  </body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "set-cookie": createSetCookieHeader(getAuthorizeCsrfCookieName(), csrf, {
        ...cookieOptions(config),
        httpOnly: false,
        maxAge: 600,
      }),
    },
  });
}

async function completeAuthorize(
  request: Request,
  env: Env,
  session: MemoryPrincipal | null,
) {
  const config = loadConfig(env);
  if (!session) {
    return Response.redirect(
      `${config.appBaseUrl}/login/github?return_to=${encodeURIComponent(request.url)}`,
      302,
    );
  }

  const formData = await request.formData();
  const csrf = formData.get("csrf");
  const authQuery = formData.get("auth_query");
  const decision = formData.get("decision");
  const csrfCookie = readCookie(request, getAuthorizeCsrfCookieName());
  if (
    typeof csrf !== "string" ||
    typeof csrfCookie !== "string" ||
    csrf !== csrfCookie ||
    typeof authQuery !== "string"
  ) {
    return new Response("Invalid authorization form submission.", { status: 400 });
  }

  const authorizeUrl = new URL("/authorize", config.appBaseUrl);
  authorizeUrl.search = authQuery;
  const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(new Request(authorizeUrl));

  if (decision === "deny") {
    const denyUrl = new URL(authRequest.redirectUri);
    denyUrl.searchParams.set("error", "access_denied");
    if (authRequest.state) {
      denyUrl.searchParams.set("state", authRequest.state);
    }
    return redirectWithHeaders(denyUrl.toString(), {
      "set-cookie": createClearedCookieHeader(getAuthorizeCsrfCookieName(), cookieOptions(config)),
    });
  }

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: authRequest,
    userId: session.userId,
    metadata: {
      login: session.login,
      email: session.email,
    },
    scope: authRequest.scope,
    props: session,
  });

  return redirectWithHeaders(redirectTo, {
    "set-cookie": createClearedCookieHeader(getAuthorizeCsrfCookieName(), cookieOptions(config)),
  });
}

function requireGithubConfig(config: ReturnType<typeof loadConfig>) {
  if (
    !config.sessionSecret ||
    !config.github.clientId ||
    !config.github.clientSecret
  ) {
    throw new Error(
      "GitHub OAuth is not fully configured. SESSION_SECRET, GITHUB_OAUTH_CLIENT_ID, and GITHUB_OAUTH_CLIENT_SECRET are required.",
    );
  }
}

async function exchangeGithubCodeForToken(
  code: string,
  config: ReturnType<typeof loadConfig>,
) {
  const redirectUri = new URL("/auth/github/callback", config.appBaseUrl).toString();
  const response = await fetch(config.github.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.github.clientId,
      client_secret: config.github.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("GitHub token exchange did not return an access token.");
  }
  return payload.access_token;
}

async function fetchGithubUser(accessToken: string, config: ReturnType<typeof loadConfig>) {
  const response = await fetch(config.github.userUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "memory-system-mcp",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub user lookup failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as GithubUser;
}

async function fetchGithubEmails(accessToken: string, config: ReturnType<typeof loadConfig>) {
  const response = await fetch(config.github.emailsUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "memory-system-mcp",
    },
  });
  if (!response.ok) {
    return [] as GithubEmail[];
  }
  return (await response.json()) as GithubEmail[];
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function redirectWithHeaders(location: string, headers: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Location", location);
  return new Response(null, { status: 302, headers: responseHeaders });
}

function redirectWithCookies(location: string, cookies: string[]) {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
}

function cookieOptions(config: ReturnType<typeof loadConfig>) {
  return {
    secure: config.appBaseUrl.startsWith("https://"),
  };
}
