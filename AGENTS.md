# Project Instructions

## Purpose

Build the simplest open-source-friendly Cloudflare Worker shell for a configurable "cloud instance" hello world.

The project should let someone clone the repo, install dependencies, run a friendly init command, deploy with Wrangler, and see a minimal page on their chosen Cloudflare-managed domain saying the cloud instance is running.

## Product Direction

- Start as a tiny deployable Worker, not a platform.
- Keep the first experience focused on initialization, deployability, and confidence.
- Treat `wrangler.jsonc` as the source of truth after init.
- Favor progressive disclosure: explain Cloudflare terms plainly at the moment a user needs them.
- Keep the project generic and reusable. Do not hardcode personal, family, or project-specific names in source, config, docs, package metadata, or examples beyond neutral configurable examples.

## Current Scope

The MVP includes:

- A TypeScript Cloudflare Worker returning minimal HTML.
- `scripts/init.ts`, which prompts for instance settings and writes directly to `wrangler.jsonc`.
- `scripts/doctor.ts`, which validates local setup and runs a Wrangler deploy dry run.
- A README with the exact happy path.
- A `.gitignore` that keeps secrets, local Wrangler state, dependencies, and build output out of Git.
- An MCP-native `/mcp` endpoint with read-only confidence tools.
- Google as the upstream identity provider, with the Worker issuing MCP-facing OAuth tokens.
- Workers KV only for OAuth client, grant, token, consent, and state records.
- An optional Cloudflare Artifacts binding for an agent-editable knowledge repository.

## Deliberate Non-Goals

Do not add these until the project explicitly needs them:

- AI
- D1
- R2
- Durable Objects
- Queues
- A frontend framework
- A separate `instance.config.ts` or other intermediate config layer

Keep the current auth surface narrow:

- Do not add passwords or custom credential storage.
- Do not add stateful MCP sessions while the read-only stateless transport is sufficient.
- Do not place `/mcp` behind Cloudflare Access; MCP-native OAuth must reach the Worker directly.
- Cloudflare Access may continue protecting browser-only routes such as `/private*`.

## Configuration Rules

- `wrangler.jsonc` is the deployed instance source of truth.
- Init may update `wrangler.jsonc`; avoid adding generated config files unless strictly necessary.
- Keep secrets out of `wrangler.jsonc`; use Wrangler secrets for secret values.
- Keep `compatibility_date` current when intentionally updating the project baseline.
- Regenerate `worker-configuration.d.ts` with `npm run cf-typegen` after changing Wrangler bindings or variables.

## Development Workflow

Preferred local checks:

```bash
npm run cf-typegen
npm run typecheck
npm run doctor
```

Use `npm run dev` for local runtime smoke tests.

When touching Cloudflare Worker code or Wrangler config, verify against current Wrangler behavior or schema rather than relying on memory.

## Design Tone

The UI should feel calm, plain, and trustworthy. This is infrastructure scaffolding, so prefer clarity over cleverness and avoid marketing-page flourish.

The CLI should be friendly to someone who does not know Cloudflare terminology yet:

- Include examples in prompts.
- Describe what each value is for.
- Validate inputs with plain-language errors.
- Leave the user with exact next commands.
