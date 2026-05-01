import type { MemoryPrincipal } from "~/domain/memory";

const SESSION_COOKIE = "memory_mcp_session";
const GITHUB_STATE_COOKIE = "memory_mcp_github_state";
const AUTHORIZE_CSRF_COOKIE = "memory_mcp_authorize_csrf";

type SignedPayload<T> = {
  payload: T;
  signature: string;
};

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export function getGithubStateCookieName() {
  return GITHUB_STATE_COOKIE;
}

export function getAuthorizeCsrfCookieName() {
  return AUTHORIZE_CSRF_COOKIE;
}

export async function encodeSignedCookie<T>(payload: T, secret: string) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSha256(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function decodeSignedCookie<T>(cookieValue: string | undefined, secret: string) {
  if (!cookieValue) {
    return null;
  }
  const [encodedPayload, signature] = cookieValue.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }
  const expected = await hmacSha256(encodedPayload, secret);
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }
  return JSON.parse(base64UrlDecode(encodedPayload)) as T;
}

export async function readSessionFromRequest(request: Request, secret?: string) {
  if (!secret) {
    return null;
  }
  const cookieValue = readCookie(request, SESSION_COOKIE);
  return decodeSignedCookie<MemoryPrincipal>(cookieValue, secret);
}

export function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return undefined;
  }
  const pairs = cookieHeader.split(";").map((item) => item.trim());
  for (const pair of pairs) {
    const [key, ...rest] = pair.split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return undefined;
}

export function createSetCookieHeader(name: string, value: string, options: Partial<CookieOptions> = {}) {
  const merged: CookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    maxAge: 60 * 60 * 8,
    ...options,
  };

  const attributes = [`${name}=${value}`];
  attributes.push(`Path=${merged.path}`);
  if (merged.httpOnly) {
    attributes.push("HttpOnly");
  }
  if (merged.secure) {
    attributes.push("Secure");
  }
  if (merged.sameSite) {
    attributes.push(`SameSite=${merged.sameSite}`);
  }
  if (merged.maxAge !== undefined) {
    attributes.push(`Max-Age=${merged.maxAge}`);
  }
  if (merged.expires) {
    attributes.push(`Expires=${merged.expires.toUTCString()}`);
  }
  return attributes.join("; ");
}

export function createClearedCookieHeader(name: string, options: Partial<CookieOptions> = {}) {
  return createSetCookieHeader(name, "", {
    ...options,
    expires: new Date(0),
    maxAge: 0,
  });
}

type CookieOptions = {
  path: string;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None";
  secure: boolean;
  maxAge?: number;
  expires?: Date;
};

async function hmacSha256(input: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(input),
  );
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function base64UrlEncode(input: string) {
  return base64UrlEncodeBytes(new TextEncoder().encode(input));
}

function base64UrlEncodeBytes(input: Uint8Array) {
  let binary = "";
  for (const byte of input) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return atob(padded);
}
