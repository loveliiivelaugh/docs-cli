import process from "node:process";

import {
  clearConfig,
  getConfigPath,
  getDefaultBaseUrl,
  loadConfig,
  saveConfig,
} from "./config.js";
import { docsRequest, loadJsonInput } from "./http.js";

const HELP_TEXT = `docs-cli

Usage:
  docs help
  docs auth login --api-key <key> [--base-url <url>]
  docs auth login --api-key-stdin [--base-url <url>]
  docs auth status [--verify]
  docs auth logout
  docs health
  docs format pdf --input-dir <dir> [--output-dir <dir>] [--recursive] [--force] [--use-hash] [--converter <name>]
  docs format csv-html --input-path <path> [--output-path <path>] [--table-title <title>] [--preserve-types]
  docs convert-pdf --input-dir <dir> [--output-dir <dir>] [--recursive] [--force] [--use-hash] [--converter <name>]
  docs convert-csv-html --input-path <path> [--output-path <path>] [--table-title <title>] [--preserve-types]
  docs extract-images --input-path <path> [--recursive] [--assets-dir-name <name>] [--filestore-cmd <cmd>] [--fail-on-upload] [--dry-run]
  docs transcribe --video-dir <dir> [--output-dir <dir>] [--model <name>]
  docs render markdown --input-path <path>
  docs render text --input-path <path>
  docs jobs status <job_id>
  docs jobs wait <job_id> [--interval <seconds>] [--timeout <seconds>]
  docs jobs artifacts <job_id>
  docs request <method> <path> [--query key=value]... [--data <json> | --input <file.json>]

Examples:
  docs auth login --api-key "$DOCS_API_KEY" --base-url http://127.0.0.1:8000
  printenv DOCS_API_KEY | docs auth login --api-key-stdin
  docs auth status --verify
  docs health
  docs format pdf --input-dir ./pdfs --output-dir ./markdown --recursive
  docs format csv-html --input-path ./exports/report.csv --output-path ./exports/report.html --preserve-types
  docs convert-pdf --input-dir ./incoming --converter docling
  docs convert-csv-html --input-path ./table.csv --table-title "Quarterly Report"
  docs jobs status abc123
  docs jobs wait abc123 --interval 2 --timeout 300
  docs jobs artifacts abc123
  docs render markdown --input-path ./notes/brief.md
  docs request POST /v1/jobs/convert-pdf --data '{"input_dir":"./pdfs"}'

Notes:
  - credentials are stored at ~/.config/docs-cli/config.json
  - DOCS_API_KEY overrides the stored key for the current command
  - DOCS_API_BASE_URL overrides the stored base URL for the current command
  - the default base URL is ${getDefaultBaseUrl()}
`;

function parseArgs(argv) {
  const positionals = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    const withoutPrefix = value.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    const key = equalsIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : withoutPrefix.slice(equalsIndex + 1);

    if (inlineValue !== undefined) {
      assignFlag(flags, key, inlineValue);
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      assignFlag(flags, key, true);
      continue;
    }

    assignFlag(flags, key, nextValue);
    index += 1;
  }

  return { positionals, flags };
}

function assignFlag(flags, key, value) {
  if (Object.prototype.hasOwnProperty.call(flags, key)) {
    const current = flags[key];
    flags[key] = Array.isArray(current) ? [...current, value] : [current, value];
    return;
  }

  flags[key] = value;
}

function normalizeList(value) {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function printHelp() {
  console.log(HELP_TEXT.trim());
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (!value || value === true) {
    throw new Error(`Missing required flag --${name}`);
  }

  return value;
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanFlag(flags, name) {
  return flags[name] === true;
}

function numberFlag(value, name, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected ${name} to be a number.`);
  }

  return parsed;
}

function isTerminalJobStatus(status) {
  return ["completed", "failed", "cancelled"].includes(String(status || "").toLowerCase());
}

async function readApiKeyFromStdin() {
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const apiKey = Buffer.concat(chunks).toString("utf8").trim();
  if (!apiKey) {
    throw new Error("No API key received on stdin");
  }

  return apiKey;
}

async function getAuthContext() {
  const config = await loadConfig();
  return {
    ...config,
    apiKey: process.env.DOCS_API_KEY || config.apiKey,
    baseUrl: process.env.DOCS_API_BASE_URL || config.baseUrl,
  };
}

async function verifyAuth(context) {
  const response = await docsRequest({
    apiKey: context.apiKey,
    baseUrl: context.baseUrl,
    method: "GET",
    pathname: "/v1/jobs/docs-cli-auth-probe",
    allowStatuses: [404],
  });

  return {
    ok: response.status === 404,
    verifiedBy: "authenticated GET /v1/jobs/docs-cli-auth-probe",
    statusCode: response.status,
  };
}

function buildConvertPdfBody(flags) {
  return {
    input_dir: requireFlag(flags, "input-dir"),
    output_dir: optionalString(flags["output-dir"]),
    recursive: booleanFlag(flags, "recursive"),
    force: booleanFlag(flags, "force"),
    use_hash: booleanFlag(flags, "use-hash"),
    converter: optionalString(flags.converter),
  };
}

function buildExtractImagesBody(flags) {
  return {
    input_path: requireFlag(flags, "input-path"),
    recursive: booleanFlag(flags, "recursive"),
    assets_dir_name: optionalString(flags["assets-dir-name"]),
    filestore_cmd: optionalString(flags["filestore-cmd"]),
    fail_on_upload: booleanFlag(flags, "fail-on-upload"),
    dry_run: booleanFlag(flags, "dry-run"),
  };
}

function buildTranscribeBody(flags) {
  return {
    video_dir: requireFlag(flags, "video-dir"),
    output_dir: optionalString(flags["output-dir"]),
    model: optionalString(flags.model),
  };
}

function buildRenderBody(flags) {
  return {
    input_path: requireFlag(flags, "input-path"),
  };
}

function buildConvertCsvHtmlBody(flags) {
  return {
    input_path: requireFlag(flags, "input-path"),
    output_path: optionalString(flags["output-path"]),
    table_title: optionalString(flags["table-title"]),
    preserve_types: booleanFlag(flags, "preserve-types"),
  };
}

async function createJob(pathname, body) {
  const context = await getAuthContext();
  const response = await docsRequest({
    apiKey: context.apiKey,
    baseUrl: context.baseUrl,
    method: "POST",
    pathname,
    body,
  });
  printJson(response.body);
}

async function handleAuth(positionals, flags) {
  const action = positionals[1];

  if (action === "login") {
    let apiKey = flags["api-key"];
    if (flags["api-key-stdin"]) {
      apiKey = await readApiKeyFromStdin();
    }
    if (!apiKey || apiKey === true) {
      apiKey = process.env.DOCS_API_KEY;
    }
    if (!apiKey) {
      throw new Error("Provide --api-key, --api-key-stdin, or DOCS_API_KEY");
    }

    const baseUrl = optionalString(flags["base-url"]) || process.env.DOCS_API_BASE_URL || getDefaultBaseUrl();

    const config = await saveConfig({
      apiKey,
      baseUrl,
      lastVerifiedAt: null,
    });

    let verification;
    try {
      verification = await verifyAuth(config);
      await saveConfig({
        ...config,
        lastVerifiedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Stored API key, but verification failed.");
      throw error;
    }

    console.log(`Saved API key to ${getConfigPath()}`);
    printJson({
      baseUrl,
      configPath: getConfigPath(),
      verification,
    });
    return;
  }

  if (action === "status") {
    const config = await loadConfig();
    if (!config.apiKey) {
      console.log("Not authenticated.");
      return;
    }

    const summary = {
      authenticated: true,
      configPath: getConfigPath(),
      baseUrl: process.env.DOCS_API_BASE_URL || config.baseUrl,
      lastVerifiedAt: config.lastVerifiedAt,
    };

    if (flags.verify) {
      const context = await getAuthContext();
      const result = await verifyAuth(context);
      await saveConfig({
        ...config,
        lastVerifiedAt: new Date().toISOString(),
      });
      printJson({
        ...summary,
        verify: result,
      });
      return;
    }

    printJson(summary);
    return;
  }

  if (action === "logout") {
    await clearConfig();
    console.log(`Removed stored credentials from ${getConfigPath()}`);
    return;
  }

  throw new Error("Usage: docs auth <login|status|logout>");
}

async function handleHealth() {
  const context = await getAuthContext();
  const response = await docsRequest({
    apiKey: context.apiKey,
    baseUrl: context.baseUrl,
    method: "GET",
    pathname: "/healthz",
  });
  printJson(response.body);
}

async function handleJobs(positionals, flags) {
  const action = positionals[1];
  const jobId = positionals[2];
  const context = await getAuthContext();

  if (action === "status" || action === "get") {
    if (!jobId) {
      throw new Error("Usage: docs jobs status <job_id>");
    }

    const response = await docsRequest({
      apiKey: context.apiKey,
      baseUrl: context.baseUrl,
      method: "GET",
      pathname: `/v1/jobs/${encodeURIComponent(jobId)}`,
    });
    printJson(response.body);
    return;
  }

  if (action === "artifacts") {
    if (!jobId) {
      throw new Error("Usage: docs jobs artifacts <job_id>");
    }

    const response = await docsRequest({
      apiKey: context.apiKey,
      baseUrl: context.baseUrl,
      method: "GET",
      pathname: `/v1/jobs/${encodeURIComponent(jobId)}/artifacts`,
    });
    printJson(response.body);
    return;
  }

  if (action === "wait") {
    if (!jobId) {
      throw new Error("Usage: docs jobs wait <job_id> [--interval <seconds>] [--timeout <seconds>]");
    }

    const intervalMs = Math.max(0.25, numberFlag(flags.interval, "--interval", 2)) * 1000;
    const timeoutMs = Math.max(1, numberFlag(flags.timeout, "--timeout", 300)) * 1000;
    const startedAt = Date.now();

    while (true) {
      const response = await docsRequest({
        apiKey: context.apiKey,
        baseUrl: context.baseUrl,
        method: "GET",
        pathname: `/v1/jobs/${encodeURIComponent(jobId)}`,
      });
      const job = response.body;

      if (isTerminalJobStatus(job.status)) {
        printJson(job);
        if (String(job.status).toLowerCase() !== "completed") {
          process.exitCode = 1;
        }
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for job ${jobId} after ${timeoutMs / 1000} seconds.`);
      }

      await new Promise((resolve) => {
        setTimeout(resolve, intervalMs);
      });
    }
  }

  throw new Error("Usage: docs jobs <status|wait|artifacts> <job_id>");
}

async function handleRender(positionals, flags) {
  const mode = positionals[1];

  if (mode === "markdown") {
    await createJob("/v1/jobs/render-markdown", buildRenderBody(flags));
    return;
  }

  if (mode === "text") {
    await createJob("/v1/jobs/render-text", buildRenderBody(flags));
    return;
  }

  throw new Error("Usage: docs render <markdown|text> --input-path <path>");
}

async function handleRequest(positionals, flags) {
  const method = positionals[1];
  const pathname = positionals[2];
  if (!method || !pathname) {
    throw new Error("Usage: docs request <method> <path> [--query key=value]... [--data <json> | --input <file.json>]");
  }

  const context = await getAuthContext();
  const response = await docsRequest({
    apiKey: context.apiKey,
    baseUrl: context.baseUrl,
    method,
    pathname,
    body: await loadJsonInput({ data: flags.data, input: flags.input }),
    query: normalizeList(flags.query),
  });
  printJson(response.body);
}

export async function runCli(argv) {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];

  if (!command || flags.help || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "auth") {
    await handleAuth(positionals, flags);
    return;
  }

  if (command === "health") {
    await handleHealth();
    return;
  }

  if (command === "format") {
    if (positionals[1] === "pdf") {
      await createJob("/v1/jobs/convert-pdf", buildConvertPdfBody(flags));
      return;
    }

    if (positionals[1] === "csv-html") {
      await createJob("/v1/jobs/convert-csv-html", buildConvertCsvHtmlBody(flags));
      return;
    }

    throw new Error("Usage: docs format <pdf|csv-html> ...");
  }

  if (command === "convert-pdf") {
    await createJob("/v1/jobs/convert-pdf", buildConvertPdfBody(flags));
    return;
  }

  if (command === "convert-csv-html") {
    await createJob("/v1/jobs/convert-csv-html", buildConvertCsvHtmlBody(flags));
    return;
  }

  if (command === "extract-images") {
    await createJob("/v1/jobs/extract-images", buildExtractImagesBody(flags));
    return;
  }

  if (command === "transcribe") {
    await createJob("/v1/jobs/transcribe", buildTranscribeBody(flags));
    return;
  }

  if (command === "render") {
    await handleRender(positionals, flags);
    return;
  }

  if (command === "jobs") {
    await handleJobs(positionals, flags);
    return;
  }

  if (command === "request") {
    await handleRequest(positionals, flags);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}
