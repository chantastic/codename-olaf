# Plan: Repo-Managed Cloudflare Access Route Policies

## Status

This is a plan only. Do not implement it until we decide the Terraform/OpenTofu runner, state storage, and group model are worth adding to the project.

The current Worker can serve `/private`, and Cloudflare Access can guard that route today through the dashboard. The goal of this plan is to eventually move the Access route policy into repo-managed infrastructure without adding sensitive membership lists or dashboard-only drift.

## Goals

- Manage the Cloudflare Access application and route policy from the repo.
- Protect `https://chantastic.cloud/private*` while leaving `https://chantastic.cloud/` public.
- Keep the Worker small and generic.
- Keep Access membership out of the application source code.
- Avoid plaintext lists of individual email addresses in committed files.
- Avoid hardcoded personal, family, or project-specific names in reusable source.
- Avoid policy concepts based on sensitive categories such as age, legal status, or family role.
- Make the setup reproducible enough that dashboard changes are not the source of truth.

## Non-Goals

- Do not add auth logic to the Worker.
- Do not parse or verify Access JWTs in the Worker for this milestone.
- Do not introduce D1, KV, R2, Durable Objects, Queues, or a frontend framework.
- Do not commit Terraform state, `.tfvars`, API tokens, personal email lists, or generated provider caches.
- Do not create relationship categories like `adults`, `minors`, `kids`, or `parents`.

## Preferences Captured

- Route policy belongs in repo-managed config, not only dashboard instructions.
- Cloudflare's Git integration deploys the Worker, but it does not automatically apply Terraform/OpenTofu.
- If IaC is added, something still has to run `tofu plan` and `tofu apply`.
- Access Groups are preferable to plaintext `allowed_emails`.
- Group names should describe relationship to the instance or access level, not sensitive person traits.
- Good candidate group names:
  - `cloud_instance_private`
  - `family`
  - `extended_family`
  - `guests`
  - `trusted_friends`
  - `admins`
- Avoid group names:
  - `adults`
  - `minors`
  - `kids`
  - `parents`
  - anything encoding age, legal status, dependency, or private family structure

## Proposed Shape

Add a separate Terraform/OpenTofu root later:

```text
infra/
  access/
    main.tf
    variables.tf
    outputs.tf
    terraform.tfvars.example
    README.md
```

This root should manage:

- A Cloudflare Zero Trust Access application for `chantastic.cloud/private*`.
- One allow policy attached to that application.
- Policy includes that reference Access Groups, not individual email addresses.

The Worker remains responsible only for serving pages:

- `/` stays public.
- `/private` renders the private page.
- Cloudflare Access enforces access before the request reaches the Worker.
- The Worker may display the `cf-access-authenticated-user-email` header when Access provides it, but that header is presentational, not authorization.

## Group Model

Preferred policy input:

```hcl
access_group_ids = [
  "00000000-0000-0000-0000-000000000000"
]
```

The repo stores group IDs or neutral group slugs. Membership lives outside the repo, either in Cloudflare Access Groups or in an identity provider.

If we later choose to manage the Access Groups in Terraform too, define groups by external identity-provider claims or other non-sensitive selectors when possible. Do not commit individual personal emails unless we explicitly decide that is acceptable for the instance owner.

## Open Decision: Who Runs Terraform/OpenTofu?

Cloudflare will not automatically apply `infra/access` just because the Worker repo is connected to GitHub. We need one of these before implementation:

1. **Manual apply from the owner machine**
   - Lowest operational complexity.
   - Still creates a manual step, but the dashboard is no longer the source of truth.
   - State must remain local or move to a remote backend.

2. **GitHub Actions for infra only**
   - Applies Access policy changes on selected branches or manual dispatch.
   - Requires GitHub secrets for Cloudflare API access.
   - Should be separate from Worker deploys to avoid recreating the duplicate deploy workflow problem.

3. **Terraform Cloud or another remote runner**
   - Stronger IaC workflow.
   - More setup and operational weight.
   - Likely too heavy until there are multiple Access policies or other Cloudflare resources to manage.

Recommended first implementation, when ready: manual `tofu plan` and `tofu apply` from the owner machine, with the plan committed and state ignored. Revisit a runner only after there are enough Access resources to justify it.

## State And Secrets

Never commit:

- `.terraform/`
- `*.tfstate`
- `*.tfstate.*`
- `*.tfvars`
- Cloudflare API tokens
- Personal email rosters

Commit:

- `*.tf`
- `.terraform.lock.hcl`
- `terraform.tfvars.example`
- Documentation explaining the ownership boundary

Use environment variables for secrets:

```bash
export TF_VAR_cloudflare_api_token="..."
```

Use untracked local variables for instance-specific non-secret values if needed:

```hcl
cloudflare_account_id = "..."
instance_domain       = "chantastic.cloud"
access_group_ids      = ["..."]
```

## Migration Steps

1. Decide whether Access Groups already exist in Cloudflare or should be created through IaC.
2. Choose neutral group names. Start with one group such as `cloud_instance_private`.
3. If an Access application already exists from dashboard setup, import it instead of replacing it.
4. Add `infra/access` with Cloudflare provider configuration.
5. Model the Access application destination as `chantastic.cloud/private*`.
6. Model the Access policy as `allow` for the configured Access Group IDs.
7. Run `tofu init`.
8. Run `tofu plan` and confirm the plan does not change unrelated Access applications.
9. Apply only after review.
10. Test:
    - `https://chantastic.cloud/` stays public.
    - `https://chantastic.cloud/private` requires Cloudflare Access.
    - An allowed group member can sign in.
    - A non-member is denied.

## Review Checklist Before Implementation

- Does the plan avoid plaintext membership lists in committed files?
- Are group names neutral and reusable?
- Is there a clear owner for group membership?
- Is Terraform/OpenTofu state safely ignored or remote?
- Is the Worker still free of auth logic?
- Are dashboard changes either imported or intentionally replaced?
- Is the IaC runner decision explicit?
- Does `npm run build` still pass after adding infra files?
- Does `npm run doctor` still pass for the Worker?

## Current Recommendation

Do not implement Access IaC yet. Keep this plan as the checkpoint. The next concrete step should be deciding whether `cloud_instance_private` is an existing Cloudflare Access Group, an IdP-backed group, or a new Access Group to be created when IaC is introduced.
