import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { applyEdits, modify, parse, type ParseError, printParseErrorCode } from "jsonc-parser";

const wranglerPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
const compatibilityDate = "2026-06-13";

type WranglerConfig = {
  name?: string;
  main?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  workers_dev?: boolean;
  artifacts?: { binding?: string; namespace?: string; remote?: boolean }[];
  route?: unknown;
  routes?: unknown[];
  vars?: Record<string, string>;
};

type Answers = {
  instanceName: string;
  workerName: string;
  domain: string;
  environment: string;
  knowledgeEnabled: boolean;
  knowledgeNamespace: string;
  knowledgeRepo: string;
};

function normalizeWorkerName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function isWorkerName(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,253}[a-z0-9])?$/.test(value);
}

function isDomain(value: string): boolean {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value);
}

function inferWorkerName(instanceName: string): string {
  const normalized = normalizeWorkerName(instanceName);
  return normalized || "cloud-instance";
}

function normalizeRepoName(value: string): string {
  return normalizeWorkerName(value);
}

function isRepoName(value: string): boolean {
  return isWorkerName(value);
}

function normalizeNamespace(value: string): string {
  return normalizeWorkerName(value);
}

function isNamespace(value: string): boolean {
  return isWorkerName(value);
}

function isYes(value: string): boolean {
  return /^(y|yes)$/i.test(value.trim());
}

async function askUntilValid(
  rl: ReturnType<typeof createInterface>,
  question: string,
  fallback: string,
  normalize: (value: string) => string,
  validate: (value: string) => boolean,
  invalidMessage: string
): Promise<string> {
  for (;;) {
    const raw = await rl.question(question);
    const value = normalize(raw || fallback);

    if (validate(value)) {
      return value;
    }

    output.write(`${invalidMessage}\n\n`);
  }
}

function updateConfig(source: string, answers: Answers): string {
  const errors: ParseError[] = [];
  const config = parse(source, errors) as WranglerConfig | undefined;

  if (errors.length > 0 || !config || typeof config !== "object") {
    const details = errors.map((error) => printParseErrorCode(error.error)).join(", ");
    throw new Error(`Could not parse wrangler.jsonc${details ? `: ${details}` : "."}`);
  }

  const formattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };
  let updated = source;

  const set = (path: (string | number)[], value: unknown) => {
    updated = applyEdits(updated, modify(updated, path, value, { formattingOptions }));
  };

  set(["name"], answers.workerName);
  set(["main"], "src/index.ts");
  set(["compatibility_date"], compatibilityDate);
  set(["compatibility_flags"], ["nodejs_compat", "global_fetch_strictly_public"]);
  set(["workers_dev"], false);
  set(["route"], {
    pattern: answers.domain,
    custom_domain: true
  });
  set(["routes"], undefined);
  const vars: Record<string, string> = {
    INSTANCE_NAME: answers.instanceName,
    INSTANCE_ENV: answers.environment
  };

  if (answers.knowledgeEnabled) {
    vars.KNOWLEDGE_REPO = answers.knowledgeRepo;
    vars.KNOWLEDGE_NAMESPACE = answers.knowledgeNamespace;
    set(["artifacts"], [
      {
        binding: "ARTIFACTS",
        namespace: answers.knowledgeNamespace
      }
    ]);
  } else {
    set(["artifacts"], undefined);
  }

  set(["vars"], vars);

  return `${updated.trim()}\n`;
}

async function main(): Promise<void> {
  if (!input.isTTY) {
    throw new Error("Please run npm run init in an interactive terminal so the prompts can collect your instance settings.");
  }

  output.write("Cloud instance init\n\n");
  output.write("This writes your chosen Cloudflare Worker name, public domain, and display labels directly to wrangler.jsonc.\n\n");

  const rl = createInterface({ input, output });

  try {
    const instanceNameAnswer = await rl.question(
      "Instance name: the friendly name shown on the page, for example \"Cloud Instance\" or \"Demo Cloud\".\nInstance name [Cloud Instance]: "
    );
    const instanceName = instanceNameAnswer.trim() || "Cloud Instance";
    const suggestedWorkerName = inferWorkerName(instanceName);

    output.write("\n");
    const workerName = await askUntilValid(
      rl,
      `Worker name: Cloudflare's internal service name. Use lowercase letters, numbers, and hyphens, for example "cloud-instance".\nWorker name [${suggestedWorkerName}]: `,
      suggestedWorkerName,
      normalizeWorkerName,
      isWorkerName,
      "Please use only lowercase letters, numbers, and hyphens. It cannot start or end with a hyphen."
    );

    output.write("\n");
    const domain = await askUntilValid(
      rl,
      "Domain or subdomain: the public address already managed by Cloudflare, for example \"cloud.example.com\".\nDomain/subdomain: ",
      "",
      normalizeDomain,
      isDomain,
      "Please enter a full domain or subdomain like cloud.example.com."
    );

    output.write("\n");
    const environmentAnswer = await rl.question(
      "Environment label: a plain label shown on the page, for example \"production\" or \"staging\".\nEnvironment label [production]: "
    );
    const environment = (environmentAnswer.trim() || "production").toLowerCase();

    output.write("\n");
    const knowledgeAnswer = await rl.question(
      "Knowledge repository: optionally bind a Cloudflare Artifacts repo for agent-editable Markdown content.\nEnable knowledge repository? [y/N]: "
    );
    const knowledgeEnabled = isYes(knowledgeAnswer);
    let knowledgeNamespace = "default";
    let knowledgeRepo = "knowledge";

    if (knowledgeEnabled) {
      output.write("\n");
      knowledgeNamespace = await askUntilValid(
        rl,
        "Artifacts namespace: a grouping for Artifacts repos. The first repo can create the namespace automatically, for example \"default\".\nArtifacts namespace [default]: ",
        "default",
        normalizeNamespace,
        isNamespace,
        "Please use only lowercase letters, numbers, and hyphens. It cannot start or end with a hyphen."
      );

      output.write("\n");
      knowledgeRepo = await askUntilValid(
        rl,
        "Knowledge repo name: the Artifacts Git repo that stores Markdown content, for example \"knowledge\".\nKnowledge repo name [knowledge]: ",
        "knowledge",
        normalizeRepoName,
        isRepoName,
        "Please use only lowercase letters, numbers, and hyphens. It cannot start or end with a hyphen."
      );
    }

    const current = await readFile(wranglerPath, "utf8");
    const next = updateConfig(current, {
      instanceName,
      workerName,
      domain,
      environment,
      knowledgeEnabled,
      knowledgeNamespace,
      knowledgeRepo
    });

    await writeFile(wranglerPath, next);

    output.write("\nDone. wrangler.jsonc is now the source of truth for this instance.\n\n");
    output.write("Next commands:\n");
    if (knowledgeEnabled) {
      output.write(`  npx wrangler artifacts repos create ${knowledgeRepo} --namespace ${knowledgeNamespace}\n`);
    }
    output.write("  npm run doctor\n");
    output.write("  npm run deploy\n");
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nInit failed: ${message}`);
  process.exitCode = 1;
});
