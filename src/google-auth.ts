import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";
import { consentPage, htmlResponse, messagePage } from "./html";
import { publicOrigin } from "./origin";
import type { AppEnv, AuthenticatedUser } from "./types";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const STATE_TTL_SECONDS = 10 * 60;
const MAX_FORM_BYTES = 16 * 1024;
const CONSENT_COOKIE = "__Host-MCP_GOOGLE_CSRF";
const STATE_COOKIE = "__Host-MCP_GOOGLE_STATE";

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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];

  for (const cookie of cookies) {
    const [cookieName, ...valueParts] = cookie.trim().split("=");

    if (cookieName === name) {
      return valueParts.join("=");
    }
  }

  return null;
}

function secureCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name: string): string {
  return secureCookie(name, "", 0);
}

function authHeaders(): Headers {
  const headers = new Headers();
  headers.set(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  );
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return headers;
}

function authHtmlResponse(html: string, init: ResponseInit = {}, cookies: string[] = []): Response {
  const headers = authHeaders();

  for (const [name, value] of new Headers(init.headers)) {
    headers.set(name, value);
  }

  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }

  return htmlResponse(html, {
    ...init,
    headers
  });
}

function redirectResponse(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location });

  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }

  return new Response(null, { status: 302, headers });
}

function withCookies(response: Response, cookies: string[]): Response {
  const headers = new Headers(response.headers);

  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function redirectUri(request: Request): string {
  return `${publicOrigin(request)}/authorize/callback`;
}

function requiredSetting(env: AppEnv, key: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"): string | Response {
  const value = env[key];

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return authHtmlResponse(
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
  return authHtmlResponse(
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

function isAuthRequest(value: unknown): value is AuthRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "responseType" in value &&
    value.responseType === "code" &&
    "clientId" in value &&
    typeof value.clientId === "string" &&
    "redirectUri" in value &&
    typeof value.redirectUri === "string" &&
    "scope" in value &&
    Array.isArray(value.scope) &&
    value.scope.every((scope) => typeof scope === "string") &&
    "state" in value &&
    typeof value.state === "string"
  );
}

function parsePendingAuthorization(value: string): PendingAuthorization | null {
  try {
    const parsed = JSON.parse(value) as { createdAt?: unknown; request?: unknown };

    if (typeof parsed.createdAt !== "string" || !isAuthRequest(parsed.request)) {
      return null;
    }

    return {
      createdAt: parsed.createdAt,
      request: parsed.request
    };
  } catch {
    return null;
  }
}

function clientDisplayName(client: ClientInfo): string {
  const name = client.clientName?.trim();
  return name || "An MCP client";
}

async function showConsent(request: Request, env: AppEnv): Promise<Response> {
  if (!env.OAUTH_PROVIDER) {
    return authError("OAuth provider is unavailable.", "Try again after the Worker has restarted.", 500);
  }

  const clientId = requiredSetting(env, "GOOGLE_CLIENT_ID");
  const clientSecret = requiredSetting(env, "GOOGLE_CLIENT_SECRET");

  if (clientId instanceof Response) {
    return clientId;
  }

  if (clientSecret instanceof Response) {
    return clientSecret;
  }

  if (allowedEmails(env).size === 0) {
    return authHtmlResponse(
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
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);

  if (!client) {
    return authError("Unknown MCP client.", "Register the client before requesting authorization.", 400);
  }

  const consentId = randomState();
  const csrfToken = randomState();
  const pending: PendingAuthorization = {
    request: oauthRequest,
    createdAt: new Date().toISOString()
  };

  await env.OAUTH_KV.put(`oauth-consent:${consentId}`, JSON.stringify(pending), {
    expirationTtl: STATE_TTL_SECONDS
  });

  return authHtmlResponse(
    consentPage({
      clientId: client.clientId,
      clientName: clientDisplayName(client),
      consentId,
      csrfToken,
      instanceName: env.INSTANCE_NAME,
      scopes: oauthRequest.scope
    }),
    { status: 200 },
    [secureCookie(CONSENT_COOKIE, csrfToken, STATE_TTL_SECONDS)]
  );
}

function authorizationErrorRedirect(request: AuthRequest, error: string, description: string): string {
  const redirect = new URL(request.redirectUri);
  redirect.searchParams.set("error", error);
  redirect.searchParams.set("error_description", description);
  redirect.searchParams.set("state", request.state);
  return redirect.toString();
}

async function submitConsent(request: Request, env: AppEnv): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(contentLength) && contentLength > MAX_FORM_BYTES) {
    return authError("Consent request is too large.", "Start the MCP connection flow again.", 413);
  }

  const form = await request.formData();
  const consentId = form.get("consent_id");
  const csrfToken = form.get("csrf_token");
  const decision = form.get("decision");
  const csrfCookie = cookieValue(request, CONSENT_COOKIE);

  if (
    typeof consentId !== "string" ||
    typeof csrfToken !== "string" ||
    !csrfCookie ||
    !constantTimeEqual(csrfToken, csrfCookie)
  ) {
    return authError("Consent validation failed.", "Start the MCP connection flow again.", 403);
  }

  const pendingText = await env.OAUTH_KV.get(`oauth-consent:${consentId}`);
  await env.OAUTH_KV.delete(`oauth-consent:${consentId}`);
  const pending = pendingText ? parsePendingAuthorization(pendingText) : null;

  if (!pending) {
    return authError("Consent request expired.", "Start the MCP connection flow again.", 400);
  }

  if (decision === "deny") {
    return redirectResponse(
      authorizationErrorRedirect(pending.request, "access_denied", "The user denied this authorization request."),
      [clearCookie(CONSENT_COOKIE)]
    );
  }

  if (decision !== "approve") {
    return authError("Consent decision is invalid.", "Start the MCP connection flow again.", 400);
  }

  const clientId = requiredSetting(env, "GOOGLE_CLIENT_ID");

  if (clientId instanceof Response) {
    return clientId;
  }

  const state = randomState();

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

  return redirectResponse(googleUrl.toString(), [
    clearCookie(CONSENT_COOKIE),
    secureCookie(STATE_COOKIE, await sha256(state), STATE_TTL_SECONDS)
  ]);
}

async function finishGoogleAuthorization(request: Request, env: AppEnv): Promise<Response> {
  if (!env.OAUTH_PROVIDER) {
    return authError("OAuth provider is unavailable.", "Try again after the Worker has restarted.", 500);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stateCookie = cookieValue(request, STATE_COOKIE);

  if (!state || !stateCookie || !constantTimeEqual(await sha256(state), stateCookie)) {
    return authError("Google callback state is invalid.", "Start the MCP connection flow again.", 403);
  }

  const pendingText = await env.OAUTH_KV.get(`oauth-state:${state}`);
  await env.OAUTH_KV.delete(`oauth-state:${state}`);
  const pending = pendingText ? parsePendingAuthorization(pendingText) : null;

  if (!pending) {
    return authError("Authorization state expired.", "Start the MCP connection flow again.", 400);
  }

  const error = url.searchParams.get("error");

  if (error) {
    return withCookies(authError("Google sign-in was canceled.", error, 400), [clearCookie(STATE_COOKIE)]);
  }

  if (!code) {
    return withCookies(
      authError("Google callback is missing data.", "The authorization code was not present."),
      [clearCookie(STATE_COOKIE)]
    );
  }

  const accessToken = await exchangeGoogleCode(request, env, code);

  if (accessToken instanceof Response) {
    return withCookies(accessToken, [clearCookie(STATE_COOKIE)]);
  }

  const user = await fetchGoogleUser(accessToken);

  if (user instanceof Response) {
    return withCookies(user, [clearCookie(STATE_COOKIE)]);
  }

  if (!allowedEmails(env).has(user.email)) {
    return withCookies(
      authError(
        "This Google account is not allowed.",
        "Ask the instance owner to add this email address to AUTH_ALLOWED_EMAILS.",
        403
      ),
      [clearCookie(STATE_COOKIE)]
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

  return redirectResponse(redirectTo, [clearCookie(STATE_COOKIE)]);
}

export async function handleAuthorizeRequest(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/authorize/callback") {
    return finishGoogleAuthorization(request, env);
  }

  if (url.pathname === "/authorize") {
    if (request.method === "POST") {
      return submitConsent(request, env);
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, POST" }
      });
    }

    if (!url.searchParams.has("client_id")) {
      return authHtmlResponse(
        messagePage(
          "MCP authorization",
          "MCP authorization",
          "Start from an MCP client.",
          "Your MCP client will send you here when it needs permission to use this cloud instance."
        )
      );
    }

    return showConsent(request, env);
  }

  return new Response("Not found", { status: 404 });
}
