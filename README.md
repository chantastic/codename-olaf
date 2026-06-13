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

The init command sets:

- `name`
- `main`
- `compatibility_date`
- `route` with `custom_domain: true`
- `vars.INSTANCE_NAME`
- `vars.INSTANCE_ENV`

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
