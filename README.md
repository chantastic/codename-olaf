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

## Useful Commands

```bash
npm run cf-typegen
npm run typecheck
npm run doctor
npm run deploy
```

`npm run cf-typegen` refreshes `worker-configuration.d.ts` from `wrangler.jsonc` when you change bindings or variables.

## GitHub Deploys

Pushes to `main` deploy with GitHub Actions after generated types, TypeScript, and Wrangler dry-run checks pass.

Set these repository secrets before relying on push deploys:

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID --repo chantastic/codename-olaf
gh secret set CLOUDFLARE_API_TOKEN --repo chantastic/codename-olaf
```

Use a Cloudflare API token created from the `Edit Cloudflare Workers` template, scoped to the account and zone this Worker deploys to.

## Notes

- Secrets do not belong in `wrangler.jsonc`. Use `wrangler secret put NAME` for secret values.
- The configured domain must already be in a Cloudflare-managed zone.
- This shell intentionally includes no persistence, authentication, or application features yet.
