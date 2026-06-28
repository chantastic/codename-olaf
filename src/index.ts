import { OAuthProvider, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { handleAuthorizeRequest } from "./google-auth";
import { htmlResponse, homePage, privatePage } from "./html";
import { handleMcpRequest } from "./mcp";
import { publicOrigin } from "./origin";
import type { AppEnv, AuthenticatedUser } from "./types";

const scopesSupported = ["mcp:read"];

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  return (
    typeof value === "object" &&
    value !== null &&
    "email" in value &&
    typeof value.email === "string" &&
    value.email.trim().length > 0
  );
}

function pageHandler(request: Request, env: AppEnv): Response {
  const url = new URL(request.url);
  const userEmail = request.headers.get("cf-access-authenticated-user-email");
  const html = url.pathname === "/private"
    ? privatePage(env.INSTANCE_NAME, userEmail)
    : homePage(env.INSTANCE_NAME, env.INSTANCE_ENV, url.host, env.KNOWLEDGE_REPO);

  return htmlResponse(html);
}

function providerOptions(origin: string): OAuthProviderOptions<AppEnv> {
  return {
    apiRoute: "/mcp",
    apiHandler: {
      async fetch(request, env, ctx) {
        if (!isAuthenticatedUser(ctx.props)) {
          return new Response("Authenticated user context is missing.", { status: 401 });
        }

        return handleMcpRequest(request, env, ctx.props);
      }
    } satisfies ExportedHandler<AppEnv>,
    defaultHandler: {
      async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === "/authorize" || url.pathname === "/authorize/callback") {
          return handleAuthorizeRequest(request, env);
        }

        return pageHandler(request, env);
      }
    } satisfies ExportedHandler<AppEnv>,
    authorizeEndpoint: `${origin}/authorize`,
    tokenEndpoint: `${origin}/oauth/token`,
    clientRegistrationEndpoint: `${origin}/oauth/register`,
    scopesSupported,
    allowPlainPKCE: false,
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: scopesSupported,
      bearer_methods_supported: ["header"],
      resource_name: "Cloud instance MCP"
    }
  };
}

function providerFor(request: Request): OAuthProvider<AppEnv> {
  const origin = publicOrigin(request);
  return new OAuthProvider(providerOptions(origin));
}

export default {
  fetch(request, env, ctx) {
    return providerFor(request).fetch(request, env, ctx);
  }
} satisfies ExportedHandler<AppEnv>;
