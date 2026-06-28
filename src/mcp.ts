import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AppEnv, AuthenticatedUser } from "./types";

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : jsonText(value)
      }
    ]
  };
}

function createServer(env: AppEnv, user: AuthenticatedUser, request: Request): McpServer {
  const url = new URL(request.url);
  const server = new McpServer({
    name: env.INSTANCE_NAME,
    version: "0.1.0"
  });

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Confirm that this MCP endpoint is reachable and authenticated.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => textResult("pong")
  );

  server.registerTool(
    "whoami",
    {
      title: "Who Am I",
      description: "Return the Google account authorized for this MCP session.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => textResult({
      email: user.email,
      name: user.name ?? null
    })
  );

  server.registerTool(
    "repo_info",
    {
      title: "Repository Info",
      description: "Return metadata for the configured Cloudflare Artifacts knowledge repository.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      if (!env.ARTIFACTS || !env.KNOWLEDGE_REPO || !env.KNOWLEDGE_NAMESPACE) {
        return textResult({
          configured: false,
          message: "No Cloudflare Artifacts knowledge repository is configured."
        });
      }

      const repo = await env.ARTIFACTS.get(env.KNOWLEDGE_REPO);

      return textResult({
        configured: true,
        name: repo.name ?? env.KNOWLEDGE_REPO,
        namespace: env.KNOWLEDGE_NAMESPACE,
        bindingVerified: true,
        id: repo.id ?? null,
        defaultBranch: repo.defaultBranch ?? null,
        remote: repo.remote ?? null,
        readOnly: repo.readOnly ?? null,
        createdAt: repo.createdAt ?? null,
        updatedAt: repo.updatedAt ?? null,
        lastPushAt: repo.lastPushAt ?? null,
        tokenOperationsAvailable: typeof repo.createToken === "function"
      });
    }
  );

  server.registerTool(
    "instance_status",
    {
      title: "Instance Status",
      description: "Return basic read-only status for this cloud instance.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => textResult({
      instanceName: env.INSTANCE_NAME,
      environment: env.INSTANCE_ENV,
      domain: url.host,
      mcpPath: "/mcp",
      serverTime: new Date().toISOString()
    })
  );

  return server;
}

export async function handleMcpRequest(request: Request, env: AppEnv, user: AuthenticatedUser): Promise<Response> {
  const server = createServer(env, user, request);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request, {
      authInfo: {
        token: "",
        clientId: "worker-oauth-provider",
        scopes: ["mcp:read"],
        resource: new URL(request.url),
        extra: user
      }
    });
  } finally {
    await server.close();
  }
}
