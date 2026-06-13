import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { parse, type ParseError, printParseErrorCode } from "jsonc-parser";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const wranglerPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
const wranglerSchemaPath = fileURLToPath(new URL("../node_modules/wrangler/config-schema.json", import.meta.url));

type Check = {
  label: string;
  ok: boolean;
  detail: string;
};

type WranglerConfig = {
  name?: unknown;
  main?: unknown;
  compatibility_date?: unknown;
  route?: { pattern?: unknown; custom_domain?: unknown };
  routes?: unknown;
  vars?: {
    INSTANCE_NAME?: unknown;
    INSTANCE_ENV?: unknown;
  };
};

function run(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      shell: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: error.message }));
  });
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function print(checks: Check[]): void {
  for (const check of checks) {
    console.log(`${check.ok ? "OK" : "Needs attention"} - ${check.label}: ${check.detail}`);
  }
}

async function main(): Promise<void> {
  const checks: Check[] = [];

  try {
    await access(wranglerSchemaPath);
    checks.push({ label: "dependencies", ok: true, detail: "node_modules are installed" });
  } catch {
    checks.push({ label: "dependencies", ok: false, detail: "run npm install first" });
  }

  const source = await readFile(wranglerPath, "utf8");
  const errors: ParseError[] = [];
  const config = parse(source, errors) as WranglerConfig | undefined;

  if (errors.length > 0 || !config) {
    const details = errors.map((error) => printParseErrorCode(error.error)).join(", ");
    checks.push({ label: "wrangler.jsonc", ok: false, detail: details || "could not parse config" });
    print(checks);
    process.exitCode = 1;
    return;
  }

  checks.push({
    label: "Worker name",
    ok: isString(config.name),
    detail: isString(config.name) ? config.name : "missing name"
  });
  checks.push({
    label: "entrypoint",
    ok: config.main === "src/index.ts",
    detail: config.main === "src/index.ts" ? "src/index.ts" : "expected src/index.ts"
  });
  checks.push({
    label: "compatibility date",
    ok: isString(config.compatibility_date),
    detail: isString(config.compatibility_date) ? config.compatibility_date : "missing compatibility_date"
  });
  checks.push({
    label: "custom domain route",
    ok: isString(config.route?.pattern) && config.route?.custom_domain === true,
    detail: isString(config.route?.pattern)
      ? `${config.route.pattern}${config.route.custom_domain === true ? " as a custom domain" : ""}`
      : "run npm run init to set your domain"
  });
  checks.push({
    label: "instance vars",
    ok:
      isString(config.vars?.INSTANCE_NAME) &&
      isString(config.vars?.INSTANCE_ENV),
    detail:
      isString(config.vars?.INSTANCE_NAME) &&
      isString(config.vars?.INSTANCE_ENV)
        ? `${config.vars.INSTANCE_NAME} (${config.vars.INSTANCE_ENV})`
        : "run npm run init to set INSTANCE_NAME and INSTANCE_ENV"
  });

  const deployDryRun = await run("npx", ["wrangler", "deploy", "--dry-run"]);
  checks.push({
    label: "Wrangler dry run",
    ok: deployDryRun.code === 0,
    detail: deployDryRun.code === 0 ? "deploy configuration validates locally" : (deployDryRun.stderr || deployDryRun.stdout).trim()
  });

  print(checks);

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Doctor failed: ${message}`);
  process.exitCode = 1;
});
