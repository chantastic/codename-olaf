# Plan: MCP-Native Google OAuth

## Status

The initial implementation was committed and pushed to `main` in commit
`ee6a649` (`feat: add MCP-native Google OAuth`). The OAuth KV namespace exists
and is bound in `wrangler.jsonc`.

Live verification on 2026-06-28 found:

- OAuth authorization-server metadata is live at `chantastic.cloud`.
- `OAUTH_KV` is configured in the Worker.
- No Worker secrets are configured yet (`wrangler secret list` returned `[]`).
- Cloudflare Access still intercepts `/mcp` with a redirect before the request
  reaches the Worker.
- The initial commit skipped an explicit MCP client consent page. A follow-up
  hardens the flow with consent, CSRF protection, CSP headers, sanitized client
  display values, and browser-bound Google state.
- Wrangler was updated to `4.105.0`; `npm audit --omit=optional` reports zero
  vulnerabilities at this checkpoint.

The implementation is therefore fail-closed but not ready for a live MCP client
until the pickup checklist below is complete.

## Pickup Checklist

1. In Cloudflare Zero Trust, remove the Access application for `/mcp*`, or
   narrow it so only `/private*` remains protected by Access.
2. Confirm `curl -i https://chantastic.cloud/mcp` returns `401 Unauthorized`
   with a `WWW-Authenticate: Bearer` header. A `302` to
   `cloudflareaccess.com` means Access is still in front of the MCP route.
3. Create a Google OAuth Web application with this authorized redirect URI:
   `https://chantastic.cloud/authorize/callback`.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AUTH_ALLOWED_EMAILS`
   with `wrangler secret put`.
5. Run `npm run cf-typegen`, `npm run typecheck`, `npm run build`, and
   `npm run doctor`.
6. Deploy with `npm run deploy` if the Git integration has not already deployed
   the latest commit.
7. Connect the first OAuth-capable MCP client to
   `https://chantastic.cloud/mcp` and verify consent, Google sign-in, `ping`,
   `whoami`, and `instance_status`.

The goal is to make the Cloudflare Worker behave like an MCP-native remote
server. MCP clients should discover OAuth metadata, register or identify
themselves, complete a standard OAuth flow, and call `https://chantastic.cloud/mcp`
with bearer tokens.

## Decision

Use the Cloudflare Worker as the MCP resource server and authorization server,
with Google OAuth as the upstream identity provider.

This means:

- Cloudflare still hosts the Worker and `/mcp`.
- Google signs in family members.
- The Worker issues MCP-facing OAuth tokens through
  `@cloudflare/workers-oauth-provider`.
- `/mcp` receives authenticated user props from the OAuth provider instead of
  trusting browser-only cookies or Cloudflare Access headers.

## Why This Instead Of Access-Only

Cloudflare Access is still useful for browser pages such as `/private`, but
MCP clients need OAuth-shaped behavior:

- OAuth authorization server metadata.
- Protected resource metadata.
- PKCE authorization code flow.
- Token endpoint.
- Dynamic client registration for compatible MCP clients.
- Bearer-token validation before serving MCP requests.

`@cloudflare/workers-oauth-provider` supplies that OAuth layer for Workers. It
requires a Workers KV namespace named `OAUTH_KV` to store clients, grants, and
token records.

## Scope Expansion

The original MVP deliberately avoided KV, Durable Objects, auth, and extra
modules. Prioritizing MCP changes that scope.

The smallest acceptable expansion is:

- Add KV only for OAuth token/client/grant storage.
- Add Worker secrets only for Google OAuth client credentials.
- Add MCP packages only when `/mcp` is implemented.
- Avoid D1, R2, Queues, AI, and a frontend framework.
- Avoid custom password auth or hand-rolled token storage.

## Proposed Runtime Shape

```text
GET /
  public status page

GET /private
  browser page, optionally protected by Cloudflare Access

GET/POST /mcp
  MCP streamable HTTP endpoint
  protected by Worker OAuth Provider bearer tokens

GET /authorize
  MCP client consent page

POST /authorize
  CSRF-checked consent decision and Google login start

GET /authorize/callback
  Browser-bound Google login finish

POST /oauth/token
  OAuth token endpoint implemented by Worker OAuth Provider

POST /oauth/register
  Dynamic client registration implemented by Worker OAuth Provider

GET /.well-known/oauth-authorization-server
GET /.well-known/oauth-protected-resource
  OAuth and MCP discovery metadata
```

## Google OAuth Model

Create a Google OAuth web application with redirect URIs for the instance:

```text
https://chantastic.cloud/authorize/callback
```

Store credentials and the private email allowlist as Wrangler secrets:

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put AUTH_ALLOWED_EMAILS
```

`AUTH_ALLOWED_EMAILS` is a comma-separated list of Google email addresses. Do
not commit that list to `wrangler.jsonc`.

## OAuth KV

The instance namespace has already been created. For a fresh clone or a new
instance, create one namespace:

```bash
wrangler kv namespace create OAUTH_KV
```

Add the generated namespace ID to `wrangler.jsonc`:

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "OAUTH_KV",
      "id": "..."
    }
  ]
}
```

After changing bindings or vars, run:

```bash
npm run cf-typegen
npm run typecheck
npm run doctor
```

## First MCP Tools

Start with read-only confidence tools:

- `ping`: confirms authenticated MCP connectivity.
- `instance_status`: returns instance name, environment, domain, and current
  server time.
- `whoami`: returns the authenticated Google email from OAuth props.
- `repo_info`: returns metadata for the optional Cloudflare Artifacts knowledge
  repository.

Do not add infrastructure-changing tools until auth, logging, and local tests
are boring.

## Implementation Steps

1. Create the Google OAuth app and Worker secrets.
2. Create `OAUTH_KV` and add the binding to `wrangler.jsonc`.
3. Install the minimum MCP/OAuth packages.
4. Add a small auth module that starts Google login, handles the callback, and
   calls `completeAuthorization`.
5. Wrap `/mcp` with `OAuthProvider`.
6. Add read-only MCP tools.
7. Regenerate `worker-configuration.d.ts`.
8. Verify locally with `npm run build` and `npm run doctor`.
9. Deploy and test with a remote MCP client that supports OAuth.

## Open Questions

- Should `/private` remain Cloudflare Access-protected separately, or should it
  eventually reuse the same Google OAuth session?
- Which MCP client is the first compatibility target?
- Should dynamic client registrations expire at the library default, or should
  this instance use a shorter TTL?
