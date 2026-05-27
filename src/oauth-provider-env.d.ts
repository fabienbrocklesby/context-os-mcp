export {};

declare global {
  interface Env {
    OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  }
}
