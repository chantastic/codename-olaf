import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { htmlResponse, messagePage } from "./html";
import { publicOrigin } from "./origin";
import type { AppEnv, AuthenticatedUser } from "./types";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const STATE_TTL_SECONDS = 10 * 60;

type PendingAuthorization = {
  request: AuthRequest;
  createdAt: string;
};

type GoogleTokenResponse = {
  access_token?: unknown;
  error?: unknown;
  error_description?: unknown;
};

type GoogleUserInfo = {
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
};

function base64Url(bytes: Uint8Array): string {
  let value = "";

  for (const byte of bytes) {
    value += String.fromCharCode(byte);
  }

  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function redirectUri(request: Request): string {
  return `${publicOrigin(request)}/authorize/callback`;
}

function requiredSetting(env: AppEnv, key: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"): string | Response {
  const value = env[key];

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return htmlResponse(
    messagePage(
      "OAuth setup required",
      "MCP authorization",
      "Google OAuth is not configured.",
      `Set ${key} with wrangler secret put ${key}, then try connecting again.`
    ),
    { status: 503 }
  );
}

function allowedEmails(env: AppEnv): Set<string> {
  return new Set(
    (env.AUTH_ALLOWED_EMAILS ?? "")
      .split(/[,\s]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function authError(heading: string, message: string, status = 400): Response {
  return htmlResponse(
    messagePage("OAuth error", "MCP authorization", heading, message),
    { status }
  );
}

async function exchangeGoogleCode(request: Request, env: AppEnv, code: string): Promise<string | Response> {
  const clientId = requiredSetting(env, "GOOGLE_CLIENT_ID");
  const clientSecret = requiredSetting(env, "GOOGLE_CLIENT_SECRET");

  if (clientId instanceof Response) {
    return clientId;
  }

  if (clientSecret instanceof Response) {
    return clientSecret;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(request)
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const token = await response.json<GoogleTokenResponse>();

  if (!response.ok || typeof token.access_token !== "string") {
    const description = typeof token.error_description === "string"
      ? token.error_description
      : typeof token.error === "string"
        ? token.error
        : "Google did not return an access token.";

    return authError("Google sign-in failed.", description, 502);
  }

  return token.access_token;
}

async function fetchGoogleUser(accessToken: string): Promise<AuthenticatedUser | Response> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  const user = await response.json<GoogleUserInfo>();
  const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  const emailVerified = user.email_verified === true || user.email_verified === "true";

  if (!response.ok || !email || !emailVerified) {
    return authError(
      "Google account could not be verified.",
      "Sign in with a Google account that has a verified email address.",
      403
    );
  }

  return {
    email,
    name: typeof user.name === "string" ? user.name : undefined,
    picture: typeof user.picture === "string" ? user.picture : undefined
  };
}

async function startGoogleAuthorization(request: Request, env: AppEnv): Promise<Response> {
  if (!env.OAUTH_PROVIDER) {
    return authError("OAuth provider is unavailable.", "Try again after the Worker has restarted.", 500);
  }

  const clientId = requiredSetting(env, "GOOGLE_CLIENT_ID");

  if (clientId instanceof Response) {
    return clientId;
  }

  if (allowedEmails(env).size === 0) {
    return htmlResponse(
      messagePage(
        "OAuth setup required",
        "MCP authorization",
        "No Google accounts are allowed yet.",
        "Set AUTH_ALLOWED_EMAILS with a comma-separated list of Google email addresses."
      ),
      { status: 503 }
    );
  }

  const oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const state = randomState();
  const pending: PendingAuthorization = {
    request: oauthRequest,
    createdAt: new Date().toISOString()
  };

  await env.OAUTH_KV.put(`oauth-state:${state}`, JSON.stringify(pending), {
    expirationTtl: STATE_TTL_SECONDS
  });

  const googleUrl = new URL(GOOGLE_AUTH_URL);
  googleUrl.searchParams.set("client_id", clientId);
  googleUrl.searchParams.set("redirect_uri", redirectUri(request));
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "openid email profile");
  googleUrl.searchParams.set("state", state);
  googleUrl.searchParams.set("prompt", "select_account");

  return Response.redirect(googleUrl.toString(), 302);
}

async function finishGoogleAuthorization(request: Request, env: AppEnv): Promise<Response> {
  if (!env.OAUTH_PROVIDER) {
    return authError("OAuth provider is unavailable.", "Try again after the Worker has restarted.", 500);
  }

  const url = new URL(request.url);
  const error = url.searchParams.get("error");

  if (error) {
    return authError("Google sign-in was canceled.", error, 400);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return authError("Google callback is missing data.", "The authorization code or state value was not present.");
  }

  const pendingText = await env.OAUTH_KV.get(`oauth-state:${state}`);
  await env.OAUTH_KV.delete(`oauth-state:${state}`);

  if (!pendingText) {
    return authError("Authorization state expired.", "Start the MCP connection flow again.", 400);
  }

  const pending = JSON.parse(pendingText) as PendingAuthorization;
  const accessToken = await exchangeGoogleCode(request, env, code);

  if (accessToken instanceof Response) {
    return accessToken;
  }

  const user = await fetchGoogleUser(accessToken);

  if (user instanceof Response) {
    return user;
  }

  if (!allowedEmails(env).has(user.email)) {
    return authError(
      "This Google account is not allowed.",
      "Ask the instance owner to add this email address to AUTH_ALLOWED_EMAILS.",
      403
    );
  }

  const requestedScopes = pending.request.scope.filter((scope) => scope === "mcp:read");
  const scope = requestedScopes.length > 0 ? requestedScopes : ["mcp:read"];
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: pending.request,
    userId: encodeURIComponent(user.email),
    metadata: {
      email: user.email,
      name: user.name
    },
    scope,
    props: user
  });

  return Response.redirect(redirectTo, 302);
}

export async function handleAuthorizeRequest(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/authorize/callback") {
    return finishGoogleAuthorization(request, env);
  }

  if (url.pathname === "/authorize") {
    if (!url.searchParams.has("client_id")) {
      return htmlResponse(
        messagePage(
          "MCP authorization",
          "MCP authorization",
          "Start from an MCP client.",
          "Your MCP client will send you here when it needs permission to use this cloud instance."
        )
      );
    }

    return startGoogleAuthorization(request, env);
  }

  return new Response("Not found", { status: 404 });
}
