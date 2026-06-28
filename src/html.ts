export function escapeHtml(value: string): string {
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

export function document(title: string, body: string): string {
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

      form {
        margin-top: 32px;
      }

      .scope-list {
        margin: 18px 0 0;
        padding-left: 22px;
        color: #334247;
        line-height: 1.6;
      }

      .client-id {
        margin-top: 18px;
        color: #66757a;
        font-size: 0.9rem;
        overflow-wrap: anywhere;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 28px;
      }

      button {
        min-height: 44px;
        padding: 0 18px;
        border: 1px solid currentColor;
        border-radius: 6px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      button[type="submit"] {
        background: #1d2528;
        color: #f7f4ef;
      }

      button.secondary {
        background: transparent;
        color: inherit;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          background: #111718;
          color: #eef4f0;
        }

        .eyebrow,
        .status,
        .scope-list,
        .client-id,
        dt {
          color: #a8b8b4;
        }

        button[type="submit"] {
          background: #eef4f0;
          color: #111718;
        }
      }
    </style>
  </head>
  <body>
${body}
  </body>
</html>`;
}

export function htmlResponse(html: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "text/html; charset=utf-8");

  return new Response(html, {
    ...init,
    headers
  });
}

export function messagePage(title: string, eyebrow: string, heading: string, message: string): string {
  return document(
    title,
    `    <main>
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h1>${escapeHtml(heading)}</h1>
      <p class="status">${escapeHtml(message)}</p>
    </main>`
  );
}

export function consentPage(options: {
  clientId: string;
  clientName: string;
  consentId: string;
  csrfToken: string;
  instanceName: string;
  scopes: string[];
}): string {
  const safeClientId = escapeHtml(options.clientId);
  const safeClientName = escapeHtml(options.clientName);
  const safeConsentId = escapeHtml(options.consentId);
  const safeCsrfToken = escapeHtml(options.csrfToken);
  const safeInstanceName = escapeHtml(options.instanceName);
  const scopeItems = options.scopes.length > 0
    ? options.scopes.map((scope) => {
      const label = scope === "mcp:read"
        ? "Use the available read-only MCP tools"
        : `Request the ${scope} permission`;

      return `<li>${escapeHtml(label)}</li>`;
    }).join("\n        ")
    : "<li>Connect to this MCP server</li>";

  return document(
    `Authorize ${options.clientName}`,
    `    <main>
      <p class="eyebrow">MCP authorization</p>
      <h1>Allow ${safeClientName}?</h1>
      <p class="status">This client is asking to connect to ${safeInstanceName}.</p>
      <ul class="scope-list">
        ${scopeItems}
      </ul>
      <p class="client-id">Client ID: ${safeClientId}</p>
      <form method="post" action="/authorize">
        <input type="hidden" name="consent_id" value="${safeConsentId}">
        <input type="hidden" name="csrf_token" value="${safeCsrfToken}">
        <div class="actions">
          <button type="submit" name="decision" value="approve">Continue with Google</button>
          <button class="secondary" type="submit" name="decision" value="deny">Cancel</button>
        </div>
      </form>
    </main>`
  );
}

export function homePage(
  instanceName: string,
  instanceEnv: string,
  instanceDomain: string,
  knowledgeRepo?: string
): string {
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

export function privatePage(instanceName: string, userEmail: string | null): string {
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
