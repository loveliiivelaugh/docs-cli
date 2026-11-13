import { execFile as execFileCallback } from "node:child_process";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const KNOWLEDGE_INCLUDE_PATHS = Object.freeze([
  "docs/Infrastructure",
  "docs/Robotics",
  "docs/API",
  "docs/tools",
  "docs/Intelligent-Memory",
]);

const INDEXABLE_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);
const DEFAULT_REPO_ROOT = path.join(os.homedir(), "Projects", "woodward-studio-docs");
const DEFAULT_MIRROR_ROOT = "/Users/michaelwoodward/Knowledge/woodward-studio-docs";
const DEFAULT_HOST = "m4";
const DEFAULT_SOURCE_KEY = "woodward-studio-docs";
const DEFAULT_SMOKE_QUERY = "Guardian Knowledge Atlas";
const DEFAULT_LAKE_SOURCE_SYSTEM = "woodward_studio_docs";
const DEFAULT_LAKE_SOURCES = "/Users/michaelwoodward/Projects/intelligence-lake/config/sources.json";
const DEFAULT_IDENTITY_MANIFEST =
  "/Users/michaelwoodward/Data/intelligence-lake/guardian-address-manifest.json";
const DEFAULT_CHUNK_MANIFEST =
  "/Users/michaelwoodward/Data/intelligence-lake/guardian-chunk-manifest.jsonl";

function asList(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseBooleanOption(value, defaultValue) {
  if (value === undefined) return defaultValue;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`Expected a boolean value, received: ${value}`);
}

export function normalizeKnowledgeIncludePaths(value) {
  const requested = asList(value).map((entry) => String(entry).replace(/\/$/, ""));
  const selected = requested.length > 0 ? requested : [...KNOWLEDGE_INCLUDE_PATHS];
  const invalid = selected.filter((entry) => !KNOWLEDGE_INCLUDE_PATHS.includes(entry));

  if (invalid.length > 0) {
    throw new Error(
      `Knowledge sync refused paths outside the allowlist: ${invalid.join(", ")}. ` +
        `Allowed paths: ${KNOWLEDGE_INCLUDE_PATHS.join(", ")}`,
    );
  }

  return [...new Set(selected)];
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function parseRsyncChangedFiles(stdout) {
  return String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\S+\s+/, "").replace(/\s+->\s+.*$/, ""))
    .filter((filePath) => INDEXABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
}

function validateHost(host) {
  if (!/^[A-Za-z0-9_.@-]+$/.test(host)) {
    throw new Error(`Invalid SSH host: ${host}`);
  }
  return host;
}

function validateRemotePath(remotePath) {
  if (!remotePath.startsWith("/") || remotePath.includes("\n") || remotePath.includes("\r")) {
    throw new Error(`Mirror root must be an absolute remote path: ${remotePath}`);
  }
  return remotePath.replace(/\/$/, "");
}

async function ensureSourcePaths(repoRoot, includePaths) {
  await access(repoRoot);
  for (const includePath of includePaths) {
    await access(path.join(repoRoot, includePath));
  }
}

function parseGuardianJson(stdout, operation) {
  try {
    return JSON.parse(String(stdout).trim());
  } catch {
    throw new Error(`Guardian ${operation} returned invalid JSON.`);
  }
}

async function defaultRun(command, args, options = {}) {
  try {
    return await execFile(command, args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
      ...options,
    });
  } catch (error) {
    const stderr = String(error?.stderr || "").trim();
    const detail = stderr ? `: ${stderr}` : "";
    throw new Error(`${command} failed${detail}`);
  }
}

function buildRemoteGuardianCommand(args) {
  return [`$HOME/.local/bin/guardian`, ...args.map(shellQuote)].join(" ");
}

async function runGuardian(run, host, args) {
  const result = await run("ssh", [
    "-o",
    "ConnectTimeout=10",
    host,
    buildRemoteGuardianCommand(args),
  ]);
  return parseGuardianJson(result.stdout, args.slice(0, 2).join(" "));
}

function buildRemoteLakeCommand(args) {
  return [`$HOME/.local/bin/lakectl`, ...args.map(shellQuote)].join(" ");
}

async function runLake(run, host, args) {
  return run("ssh", [
    "-o",
    "ConnectTimeout=10",
    host,
    buildRemoteLakeCommand(args),
  ]);
}

export function buildKnowledgeSyncConfig(flags = {}) {
  const repoRoot = path.resolve(
    optionalString(flags["repo-root"]) ||
      process.env.WOODWARD_STUDIO_DOCS_ROOT ||
      DEFAULT_REPO_ROOT,
  );
  const mirrorRoot = validateRemotePath(
    optionalString(flags["mirror-root"]) ||
      process.env.DOCS_KNOWLEDGE_MIRROR_ROOT ||
      DEFAULT_MIRROR_ROOT,
  );
  const host = validateHost(
    optionalString(flags.host) || process.env.DOCS_KNOWLEDGE_HOST || DEFAULT_HOST,
  );
  const sourceKey =
    optionalString(flags["source-key"]) ||
    process.env.DOCS_KNOWLEDGE_SOURCE_KEY ||
    DEFAULT_SOURCE_KEY;
  const smokeQuery =
    optionalString(flags["smoke-query"]) ||
    process.env.DOCS_KNOWLEDGE_SMOKE_QUERY ||
    DEFAULT_SMOKE_QUERY;
  const identityManifest = validateRemotePath(
    optionalString(flags["identity-manifest"]) ||
      process.env.DOCS_KNOWLEDGE_IDENTITY_MANIFEST ||
      DEFAULT_IDENTITY_MANIFEST,
  );
  const chunkManifest = validateRemotePath(
    optionalString(flags["chunk-manifest"]) ||
      process.env.DOCS_KNOWLEDGE_CHUNK_MANIFEST ||
      DEFAULT_CHUNK_MANIFEST,
  );

  return {
    repoRoot,
    mirrorRoot,
    host,
    sourceKey,
    smokeQuery,
    identityManifest,
    chunkManifest,
    lakeSourceSystem:
      optionalString(flags["lake-source-system"]) || DEFAULT_LAKE_SOURCE_SYSTEM,
    lakeSources:
      optionalString(flags["lake-sources"]) || DEFAULT_LAKE_SOURCES,
    includePaths: normalizeKnowledgeIncludePaths(flags["include-path"]),
    includeEmbeddings: parseBooleanOption(flags["include-embeddings"], false),
    dryRun: parseBooleanOption(flags["dry-run"], false),
    skipSmoke: parseBooleanOption(flags["skip-smoke"], false),
  };
}

export async function runKnowledgeSync({ flags = {}, run = defaultRun } = {}) {
  const config = buildKnowledgeSyncConfig(flags);
  await ensureSourcePaths(config.repoRoot, config.includePaths);

  const rsyncArgs = [
    "-az",
    "--relative",
    "--itemize-changes",
    "--include=*/",
    "--include=*.md",
    "--include=*.mdx",
    "--include=*.txt",
    "--exclude=*",
  ];

  if (config.dryRun) rsyncArgs.push("--dry-run");
  rsyncArgs.push(...config.includePaths, `${config.host}:${config.mirrorRoot}/`);

  const syncResult = await run("rsync", rsyncArgs, { cwd: config.repoRoot });
  const changedFiles = parseRsyncChangedFiles(syncResult.stdout);

  if (config.dryRun) {
    return {
      ok: true,
      dry_run: true,
      source_root: config.repoRoot,
      mirror_root: `${config.host}:${config.mirrorRoot}`,
      include_paths: config.includePaths,
      changed_files: changedFiles,
      changed_count: changedFiles.length,
      remote_index_attempted: false,
      note: "Rsync was previewed only; Guardian indexing was not run because the mirror was not changed.",
    };
  }

  await runLake(run, config.host, ["init", "--sources", config.lakeSources]);
  const bridgeArgs = [
    "bridge-docs",
    "--root-dir",
    config.mirrorRoot,
    "--source-key",
    config.sourceKey,
    "--source-system",
    config.lakeSourceSystem,
    "--manifest-out",
    config.identityManifest,
  ];
  for (const includePath of config.includePaths) {
    bridgeArgs.push("--include-path", includePath);
  }
  const bridgeResult = await runLake(run, config.host, bridgeArgs);
  const bridgedDocuments = Number(
    String(bridgeResult.stdout).match(/bridged\s+(\d+)\s+document/i)?.[1] ?? 0,
  );

  const indexArgs = [
    "knowledge-atlas",
    "index",
    "--source-key",
    config.sourceKey,
    "--root-dir",
    config.mirrorRoot,
    "--include-embeddings",
    String(config.includeEmbeddings),
  ];
  for (const includePath of config.includePaths) {
    indexArgs.push("--include-path", includePath);
  }

  const index = await runGuardian(run, config.host, indexArgs);
  const chunkImport = await runLake(run, config.host, [
    "import-guardian-chunks",
    "--file",
    config.chunkManifest,
  ]);
  const registeredChunks = Number(
    String(chunkImport.stdout).match(/registered\s+(\d+)\s+Guardian chunk/i)?.[1] ?? 0,
  );
  const status = await runGuardian(run, config.host, [
    "knowledge-atlas",
    "status",
    "--source-key",
    config.sourceKey,
  ]);

  let smoke = null;
  if (!config.skipSmoke) {
    smoke = await runGuardian(run, config.host, [
      "knowledge-atlas",
      "search",
      config.smokeQuery,
      "--source-key",
      config.sourceKey,
      "--mode",
      "lexical",
      "--limit",
      "3",
    ]);
    if (!Array.isArray(smoke.results) || smoke.results.length === 0) {
      throw new Error(`Knowledge sync completed, but the smoke query returned no results: ${config.smokeQuery}`);
    }
  }

  return {
    ok: true,
    dry_run: false,
    source_root: config.repoRoot,
    mirror_root: `${config.host}:${config.mirrorRoot}`,
    include_paths: config.includePaths,
    changed_files: changedFiles,
    changed_count: changedFiles.length,
    ducklake_bridge: {
      documents: bridgedDocuments,
      identity_manifest: config.identityManifest,
      source_system: config.lakeSourceSystem,
    },
    index: {
      run_id: index.run_id,
      documents_indexed: index.documents_indexed,
      documents_skipped: index.documents_skipped,
      sections_indexed: index.sections_indexed,
      chunks_indexed: index.chunks_indexed,
      relations_written: index.relations_written,
      embedding_model: index.embedding_model,
      duration_ms: index.duration_ms,
      chunk_manifest_path: index.chunk_manifest_path,
      chunk_addresses_exported: index.chunk_addresses_exported,
    },
    ducklake_chunks: {
      registered: registeredChunks,
      manifest: config.chunkManifest,
    },
    totals: status.counts,
    smoke_test: smoke
      ? {
          query: config.smokeQuery,
          mode: smoke.mode,
          result_count: smoke.results.length,
          top_result: {
            path: smoke.results[0].path,
            heading: smoke.results[0].heading,
            start_line: smoke.results[0].start_line,
          },
        }
      : null,
  };
}
