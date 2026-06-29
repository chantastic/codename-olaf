# Cloud Instance Worker Shell

A tiny, open-source-friendly Cloudflare Worker starter for a configurable "cloud instance" hello world. The root page stays plain and public. The optional MCP endpoint uses Google OAuth, Workers KV, and MCP-native bearer tokens. After init, `wrangler.jsonc` is the source of truth for deployed instance settings.

## Happy Path

```bash
npm install
npm run init
npm run doctor
npm run deploy
```

Open the domain you entered during init. You should see a minimal page saying your cloud instance is running.

## What Init Asks

`npm run init` writes directly to `wrangler.jsonc`.

- Instance name: the friendly name shown on the page, for example `Cloud Instance` or `Demo Cloud`.
- Worker name: Cloudflare's internal Worker name. Use lowercase letters, numbers, and hyphens, for example `cloud-instance`.
- Domain/subdomain: the public address already managed by Cloudflare, for example `cloud.example.com`.
- Environment label: a plain label shown on the page. Defaults to `production`.
- Knowledge repository: optionally binds a Cloudflare Artifacts repo for agent-editable Markdown content.

The init command sets:

- `name`
- `main`
- `compatibility_date`
- `route` with `custom_domain: true`
- `vars.INSTANCE_NAME`
- `vars.INSTANCE_ENV`
- Optional `vars.KNOWLEDGE_REPO`, `vars.KNOWLEDGE_NAMESPACE`, and an `ARTIFACTS` binding.

If you enable the knowledge repository, create the repo before deploy:

```bash
npx wrangler artifacts repos create knowledge --namespace default
```

Artifacts repos expose Git remotes. Mint a repo-scoped token when you want to clone, fetch, pull, or push:

```bash
npx wrangler artifacts repos issue-token knowledge --namespace default
```

## Local Development

```bash
npm run dev
```

Wrangler serves the Worker locally. The page should show your configured instance name, environment, and domain.

## Private Page

The Worker serves a private page at `/private`. Protect only that page with Cloudflare Access:

1. In Cloudflare Zero Trust, go to **Access controls > Applications**.
2. Create a **Self-hosted and private** application.
3. Add the public hostname for your instance domain.
4. Set the application path to `private*`.
5. Add an Allow policy for the people who should reach the page.

The root page stays public. Cloudflare Access checks requests before they reach the Worker, and the private page will show the authenticated user email when Access sends it. Without the Access application, `/private` is just another public Worker route.

## MCP Native OAuth

The Worker exposes a remote MCP endpoint at `/mcp`. It uses `@cloudflare/workers-oauth-provider` as the OAuth authorization server for MCP clients, then uses Google OAuth as the upstream sign-in provider.

The initial tools are read-only:

- `ping`: confirms that an authenticated MCP client can reach the Worker.
- `whoami`: returns the Google account authorized for the MCP session.
- `instance_status`: returns the instance name, environment, domain, MCP path, and server time.
- `repo_info`: returns metadata for the configured Cloudflare Artifacts knowledge repository.

### Resume Later

Nothing in this checklist needs to be completed now. The Worker code and OAuth
KV binding are deployed, but MCP login is intentionally paused until these
external setup steps are finished:

- [ ] In Cloudflare Zero Trust, remove the Access application for `/mcp*`, or
  narrow it so Access protects only `/private*`.
- [ ] Confirm `curl -i https://chantastic.cloud/mcp` returns `401 Unauthorized`
  with a `WWW-Authenticate: Bearer` header instead of an Access `302` redirect.
- [ ] Create a Google OAuth Web application with
  `https://chantastic.cloud/authorize/callback` as an authorized redirect URI.
- [ ] Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
  `AUTH_ALLOWED_EMAILS` using `wrangler secret put`.
- [ ] Run the local checks and deploy the latest `main` branch.
- [ ] Connect an OAuth-capable MCP client to `https://chantastic.cloud/mcp` and
  test consent, Google sign-in, `ping`, `whoami`, and `instance_status`.

The detailed setup notes below are here for that future session.

### Cloudflare Setup

This step is already complete for the checked-in `chantastic.cloud` instance.
For a fresh instance, create one KV namespace for OAuth client, grant, and token
records:

```bash
wrangler kv namespace create OAUTH_KV
```

Add the generated namespace ID to `wrangler.jsonc` under `kv_namespaces`, then regenerate types:

```bash
npm run cf-typegen
```

### Google OAuth Setup

Create a Google OAuth client for a web application. Add this authorized redirect URI:

```text
https://chantastic.cloud/authorize/callback
```

Store the Google client credentials and allowed Google accounts as Worker secrets:

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put AUTH_ALLOWED_EMAILS
```

`AUTH_ALLOWED_EMAILS` is a comma-separated list, for example:

```text
person@example.com,other@example.com
```

For local development, put the same values in an uncommitted `.dev.vars` file:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
AUTH_ALLOWED_EMAILS=person@example.com,other@example.com
```

The authorization flow fails closed until all three values are configured.

Before testing an MCP client, make sure Cloudflare Access is not protecting
`/mcp`. Access may continue to protect `/private*`, but an Access application on
`/mcp*` intercepts the request before the Worker can return its MCP OAuth
challenge.

The Worker shows an explicit consent page naming the MCP client and requested
permissions before redirecting to Google. The consent and Google callback flows
use one-time, short-lived cookies and KV records.

Confirm the route is ready for MCP-native OAuth:

```bash
curl -i https://chantastic.cloud/mcp
```

The expected response is `401 Unauthorized` with a `WWW-Authenticate: Bearer`
header. A `302` redirect to `cloudflareaccess.com` means the old Access route
still needs to be removed or narrowed to `/private*`.

## Useful Commands

```bash
npm run cf-typegen
npm run typecheck
npm run doctor
npm run deploy
```

`npm run cf-typegen` refreshes `worker-configuration.d.ts` from `wrangler.jsonc` when you change bindings or variables.

## Notes

- Secrets do not belong in `wrangler.jsonc`. Use `wrangler secret put NAME` for secret values.
- The configured domain must already be in a Cloudflare-managed zone.
- `/mcp` intentionally adds KV-backed OAuth. Do not put Google credentials or family email lists in `wrangler.jsonc`.
