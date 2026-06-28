# Plan: Agent-First Subdomain Workers

## Status

This document records the proposed direction for apps hosted at
`*.chantastic.cloud`. It is an architecture plan, not an implementation
commitment. The existing Worker at `chantastic.cloud` remains independent until
the platform components below are deliberately introduced.

## Goal

Make it fast to create, revise, deploy, inspect, and roll back small apps through
an agent without requiring anyone to operate Git or configure Cloudflare for
each app.

The intended interaction is conversational:

```text
Create a small app called moodboard at moodboard.chantastic.cloud.
```

The agent should turn that request into an isolated deployed Worker. Git may be
used internally, including through Cloudflare Artifacts, but cloning, branching,
committing, pushing, and managing remotes must not be part of the user workflow.

## Core Decisions

- `*.chantastic.cloud` is the public runtime namespace.
- Each app runs as an isolated Worker, not as code inside one shared application
  Worker.
- A single dispatch Worker performs hostname-to-app routing.
- A Workers for Platforms dispatch namespace contains the app Workers.
- App creation and deployment are API-first and agent-operated.
- Source history is optional infrastructure. Cloudflare Artifacts is the
  preferred candidate, but the platform presents versions rather than Git
  concepts.
- Cloudflare DNS and routing are configured once for the wildcard, not once per
  app.

## Mental Model

```text
Subdomain        app identity and public address
App registry     desired state and deployment metadata
Artifact         durable source and version history
User Worker      isolated runtime
Dispatcher       hostname router
Agent            author and operator
```

## Proposed Architecture

```text
*.chantastic.cloud
        |
        v
dispatch Worker
        |
        +-- reads hostname and app registry
        |
        v
Workers for Platforms dispatch namespace
        |
        +-- moodboard
        +-- timer
        +-- scratchpad

control plane
        |
        +-- app registry
        +-- source/version store
        +-- build and deploy service
        +-- agent tools
```

### Wildcard Routing

Cloudflare receives all matching subdomains through one wildcard DNS record and
one wildcard Worker route. The dispatch Worker extracts the app slug from the
hostname and resolves it to a Worker in the dispatch namespace.

Examples:

```text
moodboard.chantastic.cloud -> Worker "moodboard"
timer.chantastic.cloud     -> Worker "timer"
```

Unknown, disabled, or invalid slugs should return a controlled platform response
rather than falling through to another app.

### Isolated App Workers

Each app is deployed as a separate user Worker in the dispatch namespace. This
provides an independent code boundary and allows apps to be deployed, disabled,
or rolled back without redeploying their neighbors.

Bindings and capabilities should be explicit per app. An app should not inherit
platform credentials or access another app's data by default.

### App Registry

The registry is the control plane's source of truth for app identity and desired
state. It should contain operational metadata, not application source code.

An initial record could look like:

```json
{
  "slug": "moodboard",
  "hostname": "moodboard.chantastic.cloud",
  "workerName": "moodboard",
  "status": "active",
  "currentVersion": "v7",
  "sourceRef": "artifact-reference",
  "createdAt": "2026-06-28T00:00:00Z",
  "updatedAt": "2026-06-28T00:00:00Z"
}
```

The first implementation can use KV if records are simple and reads dominate.
Use D1 instead if the control plane quickly needs transactional updates, richer
queries, deployment history, ownership, or audit relationships.

## Agent-First Workflow

### Create

1. The user asks an agent to create an app and names its purpose or preferred
   subdomain.
2. The agent validates and reserves the slug.
3. The agent generates a minimal Worker project in a temporary workspace.
4. The agent builds and validates the Worker.
5. The agent stores a durable source snapshot when version storage is enabled.
6. The platform uploads the compiled Worker to the dispatch namespace.
7. The registry is updated only after deployment succeeds.
8. The agent verifies the public URL and reports it to the user.

### Update

1. The user describes a change; no repository operation is requested.
2. The agent loads the current source version into a temporary workspace.
3. The agent edits, builds, tests, and deploys a new Worker version.
4. The platform records the new source reference and deployment result.
5. The agent verifies the live behavior.

### Roll Back

1. The user asks to restore a previous named or timestamped version.
2. The platform resolves that product-level version to source and deployment
   metadata.
3. The agent redeploys it and records a new rollback event.

The user-facing vocabulary is app, version, publish, restore, and remove. Git
terms should appear only in diagnostics or advanced inspection surfaces.

## Source And Version Storage

Cloudflare Artifacts is the preferred candidate for durable app source because
it can provide Git-backed storage close to the rest of the platform. It should
remain behind a small storage interface so the runtime platform does not depend
on private-beta behavior.

Conceptually, the interface needs only:

```text
load(app, version)
save(app, files, metadata)
listVersions(app)
```

The implementation may create commits, branches, or repositories internally.
Those are storage mechanics, not prerequisites for using the platform.

Start with one platform-owned source repository containing apps by slug unless
scale, access boundaries, or Artifacts constraints justify one repository per
app:

```text
apps/
  moodboard/
  timer/
  scratchpad/
```

The deployment record should preserve both the source reference and the Worker
version identifier so source history and running code can be reconciled.

## Agent Tool Surface

The control plane should expose narrow tools rather than shell access:

```text
create_app(slug, specification)
get_app(slug)
get_app_source(slug, version?)
preview_app(slug, changes)
publish_app(slug, source)
list_app_versions(slug)
restore_app(slug, version)
disable_app(slug)
delete_app(slug)
```

Tools that mutate production should return structured deployment results and
support idempotency. Destructive actions should require explicit confirmation;
disabling should be preferred over immediate deletion.

## Security And Operational Boundaries

- The dispatcher routes requests but does not execute app code itself.
- App Workers receive only their declared bindings and secrets.
- Platform deployment credentials remain in the control plane, never in app
  source or app bindings.
- Slugs are normalized and validated before being used as hostnames or Worker
  names.
- Registry updates and deployment events are auditable.
- Builds run in temporary isolated workspaces with resource and time limits.
- Publishing verifies that the hostname resolves to the intended app Worker.
- Rollback remains possible even when the latest generated source is invalid.
- App deletion has a retention window for source and deployment metadata.

## Suggested Delivery Sequence

### Phase 1: Prove Dispatch

- Configure wildcard DNS and routing for `*.chantastic.cloud`.
- Create one dispatch namespace and one dispatch Worker.
- Deploy two small user Workers manually through an API or script.
- Verify hostname routing and runtime isolation.

### Phase 2: Build The Control Plane

- Add the app registry.
- Implement create, upload, disable, and inspect operations.
- Record deployment state and Worker version identifiers.
- Keep source in temporary workspaces initially if necessary.

### Phase 3: Add Agent Operations

- Expose narrow app-management tools to the agent.
- Add build, validation, deployment verification, and structured errors.
- Make create and update work without any Git commands from the user.

### Phase 4: Add Durable Versions

- Introduce the source storage interface.
- Integrate Cloudflare Artifacts if its behavior and limits are suitable.
- Add version listing and rollback.
- Preserve an alternate storage path while Artifacts remains private beta.

### Phase 5: Harden

- Add app-level bindings and secrets management.
- Add preview deployments and promotion.
- Add quotas, audit logs, deletion retention, and recovery procedures.
- Define ownership and authorization before exposing app-management tools beyond
  the instance owner.

## Deliberate Non-Goals For The First Slice

- A general-purpose hosting product or public app marketplace.
- A GitHub-first deployment pipeline.
- One Cloudflare DNS or dashboard setup flow per app.
- Shared execution of unrelated apps inside the dispatcher.
- Arbitrary infrastructure provisioning from generated app code.
- A full browser IDE.
- Per-app databases, queues, and custom domains before basic isolated deployment
  is reliable.

## Open Questions

- Is Workers for Platforms enabled for this Cloudflare account and plan?
- Should the registry use KV initially, or does deployment history make D1 the
  better starting point?
- Should generated apps begin from one constrained Worker template or support
  multiple capability profiles?
- What is the smallest useful preview model before production publishing?
- How should per-app secrets be created and rotated without exposing them to the
  authoring agent?
- Does Cloudflare Artifacts support the required write, version, and recovery
  workflow reliably enough for primary storage?
- Should `chantastic.cloud` host the control-plane UI and MCP tools, or should
  management live on a separate protected hostname?
- What confirmation policy should apply to publish, disable, restore, and
  delete operations?

## First Concrete Milestone

The first milestone should prove that two independently deployed user Workers
can be reached at two `*.chantastic.cloud` hostnames through one dispatcher,
with no per-app DNS changes. Once that path works, automate the exact same
operation behind one structured agent tool before adding source persistence or
a richer UI.
