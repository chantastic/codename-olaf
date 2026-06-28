import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export type AppEnv = Env & {
  ARTIFACTS?: Artifacts;
  AUTH_ALLOWED_EMAILS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  KNOWLEDGE_NAMESPACE?: string;
  KNOWLEDGE_REPO?: string;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER?: OAuthHelpers;
};

export type AuthenticatedUser = {
  email: string;
  name?: string;
  picture?: string;
};
