import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function document(title: string, body: string): string {
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f4ef;
        color: #1d2528;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
      }

      main {
        width: min(100% - 48px, 680px);
      }

      p {
        margin: 0;
      }

      .eyebrow {
        color: #506066;
        font-size: 0.84rem;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      h1 {
        margin: 16px 0 18px;
        font-size: clamp(2.4rem, 7vw, 5.2rem);
        line-height: 0.96;
        letter-spacing: 0;
      }

      .status {
        font-size: 1.18rem;
        line-height: 1.6;
        color: #334247;
      }

      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 10px 18px;
        margin: 32px 0 0;
        padding: 22px 0 0;
        border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      }

      dt {
        color: #66757a;
        font-weight: 700;
      }

      dd {
        margin: 0;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          background: #111718;
          color: #eef4f0;
        }

        .eyebrow,
        .status,
        dt {
          color: #a8b8b4;
        }
      }
    </style>
  </head>
  <body>
${body}
  </body>
</html>`;
}

function textToolResult(text: string) {
  return {
    content: [{ type: "text" as const, text }]
  };
}

function createKnowledgeMcpServer(env: Env, request: Request): McpServer {
  const server = new McpServer({
    name: "chantastic-knowledge",
    version: "0.1.0"
  });

  server.registerTool(
    "ping",
    {
      description: "Confirm that the Chantastic Cloud knowledge MCP endpoint is reachable.",
      inputSchema: {}
    },
    async () => textToolResult("pong")
  );

  server.registerTool(
    "repo_info",
    {
      description: "Return the configured Cloudflare Artifacts knowledge repository metadata.",
      inputSchema: {}
    },
    async () => {
      const repo = await env.ARTIFACTS.get(env.KNOWLEDGE_REPO);
      const accessEmail = request.headers.get("cf-access-authenticated-user-email");
      const accessJwtPresent = request.headers.has("cf-access-jwt-assertion");

      return textToolResult(JSON.stringify({
        repo: {
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
        },
        access: {
          authenticatedUserEmail: accessEmail,
          jwtPresent: accessJwtPresent
        }
      }, null, 2));
    }
  );

  return server;
}

function homePage(instanceName: string, instanceEnv: string, instanceDomain: string, knowledgeRepo?: string): string {
  const safeName = escapeHtml(instanceName);
  const safeEnv = escapeHtml(instanceEnv);
  const safeDomain = escapeHtml(instanceDomain);
  const safeKnowledgeRepo = knowledgeRepo ? escapeHtml(knowledgeRepo) : null;

  return document(
    instanceName,
    `    <main>
      <p class="eyebrow">Cloud instance</p>
      <h1>${safeName} is running.</h1>
      <p class="status">This Cloudflare Worker is answering requests for ${safeDomain}.</p>
      <dl>
        <dt>Environment</dt>
        <dd>${safeEnv}</dd>
        <dt>Domain</dt>
        <dd>${safeDomain}</dd>
        ${safeKnowledgeRepo ? `<dt>Knowledge</dt>
        <dd>${safeKnowledgeRepo}</dd>` : ""}
      </dl>
    </main>`
  );
}

function privatePage(instanceName: string, userEmail: string | null): string {
  const safeName = escapeHtml(instanceName);
  const safeUserEmail = userEmail ? escapeHtml(userEmail) : "an authenticated visitor";

  return document(
    `${instanceName} private page`,
    `    <main>
      <p class="eyebrow">Private page</p>
      <h1>${safeName} is private.</h1>
      <p class="status">Cloudflare Access let ${safeUserEmail} through.</p>
    </main>`
  );
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      const server = createKnowledgeMcpServer(env, request);
      return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
    }

    const userEmail = request.headers.get("cf-access-authenticated-user-email");
    const html = url.pathname === "/private"
      ? privatePage(env.INSTANCE_NAME, userEmail)
      : homePage(env.INSTANCE_NAME, env.INSTANCE_ENV, url.host, env.KNOWLEDGE_REPO);

    return new Response(
      html,
      {
        headers: {
          "content-type": "text/html; charset=utf-8"
        }
      }
    );
  }
} satisfies ExportedHandler<Env>;
