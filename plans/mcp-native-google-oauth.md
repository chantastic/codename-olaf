# Plan: MCP-Native Google OAuth

## Status

The initial implementation is present in the Worker. Deployment still requires
the Google OAuth secrets and OAuth KV namespace described below, followed by a
live MCP client verification.

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
  OAuth authorization UI and Google login start/finish

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

Store credentials as Wrangler secrets:

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
```

Store non-secret auth settings in `wrangler.jsonc` vars:

```jsonc
{
  "vars": {
    "INSTANCE_NAME": "Chantastic Cloud",
    "INSTANCE_ENV": "production",
    "AUTH_ALLOWED_EMAILS": "person@example.com,other@example.com"
  }
}
```

If the allowed user list becomes sensitive or noisy, move it out of committed
config before implementation.

## OAuth KV

Create one namespace for the instance:

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

- Should `AUTH_ALLOWED_EMAILS` be committed for this personal instance, or
  should allowlisting be represented by an uncommitted secret/config value?
- Should `/private` remain Cloudflare Access-protected separately, or should it
  eventually reuse the same Google OAuth session?
- Which MCP client is the first compatibility target?
- Should dynamic client registrations expire at the library default, or should
  this instance use a shorter TTL?
