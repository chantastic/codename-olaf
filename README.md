# Cloud Instance Worker Shell

A tiny, open-source-friendly Cloudflare Worker starter for a configurable "cloud instance" hello world. It starts with no auth, AI, storage, queues, framework, or extra modules. After init, `wrangler.jsonc` is the source of truth.

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

## MCP Endpoint

The Worker serves a remote MCP endpoint at `/mcp`.

```text
https://your-domain.example/mcp
```

The first MCP tools are intentionally small:

- `ping`: confirms that an MCP client can reach the Worker.
- `repo_info`: returns the configured Cloudflare Artifacts repo metadata and whether Cloudflare Access identity headers reached the Worker.

Protect `/mcp*` with Cloudflare Access before adding tools that read or write private knowledge content.

Cloudflare Access is not MCP-native OAuth. If a client reports `auth unsupported`, use an Access service token and a local MCP proxy that can send custom headers:

```json
{
  "mcpServers": {
    "cloud-instance-knowledge": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-domain.example/mcp",
        "--header",
        "CF-Access-Client-Id:${CF_ACCESS_CLIENT_ID}",
        "--header",
        "CF-Access-Client-Secret:${CF_ACCESS_CLIENT_SECRET}"
      ],
      "env": {
        "CF_ACCESS_CLIENT_ID": "<service-token-client-id>",
        "CF_ACCESS_CLIENT_SECRET": "<service-token-client-secret>"
      }
    }
  }
}
```

The Access application must include a Service Auth policy that allows that service token.

Codex can also send Access service-token headers directly from environment variables:

```toml
[mcp_servers.cloud_instance_knowledge]
enabled = true
url = "https://your-domain.example/mcp"

[mcp_servers.cloud_instance_knowledge.env_http_headers]
CF-Access-Client-Id = "CF_ACCESS_CLIENT_ID"
CF-Access-Client-Secret = "CF_ACCESS_CLIENT_SECRET"
```

The Codex process must have `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` in its environment.

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
- This shell intentionally includes no persistence, authentication, or application features yet.
