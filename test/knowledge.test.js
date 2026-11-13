import assert from "node:assert/strict";
import test from "node:test";

import {
  KNOWLEDGE_INCLUDE_PATHS,
  buildKnowledgeSyncConfig,
  normalizeKnowledgeIncludePaths,
  parseBooleanOption,
  parseRsyncChangedFiles,
  shellQuote,
} from "../src/knowledge.js";

test("knowledge sync defaults to the approved source paths", () => {
  assert.deepEqual(normalizeKnowledgeIncludePaths(undefined), KNOWLEDGE_INCLUDE_PATHS);
});

test("knowledge sync accepts an allowlisted subset and removes duplicates", () => {
  assert.deepEqual(
    normalizeKnowledgeIncludePaths([
      "docs/Robotics/",
      "docs/Robotics",
      "docs/Infrastructure",
    ]),
    ["docs/Robotics", "docs/Infrastructure"],
  );
});

test("knowledge sync rejects paths outside the allowlist", () => {
  assert.throws(
    () => normalizeKnowledgeIncludePaths("docs/DailyJournal"),
    /refused paths outside the allowlist/,
  );
});

test("boolean options are explicit", () => {
  assert.equal(parseBooleanOption(undefined, false), false);
  assert.equal(parseBooleanOption("true", false), true);
  assert.equal(parseBooleanOption("false", true), false);
  assert.throws(() => parseBooleanOption("sometimes", false), /Expected a boolean/);
});

test("rsync output retains only indexable changed files", () => {
  const stdout = [
    ".d..t...... docs/Infrastructure/",
    ">f+++++++++ docs/Infrastructure/new-runbook.md",
    ">f.st...... docs/Robotics/robot.mdx",
    ">f+++++++++ docs/API/notes.txt",
    ">f+++++++++ docs/API/diagram.png",
  ].join("\n");

  assert.deepEqual(parseRsyncChangedFiles(stdout), [
    "docs/Infrastructure/new-runbook.md",
    "docs/Robotics/robot.mdx",
    "docs/API/notes.txt",
  ]);
});

test("remote shell arguments are quoted", () => {
  assert.equal(shellQuote("robot's controller"), `'robot'"'"'s controller'`);
});

test("knowledge sync requires configured locations and defaults embeddings off", () => {
  const flags = {
    "repo-root": process.cwd(),
    "mirror-root": "/mirror",
    "lake-sources": "/sources.json",
    "identity-manifest": "/identity.json",
    "chunk-manifest": "/chunks.jsonl",
  };
  const config = buildKnowledgeSyncConfig(flags);
  assert.equal(config.includeEmbeddings, false);
  assert.equal(config.host, "m4");
  assert.equal(config.sourceKey, "woodward-studio-docs");
  assert.equal(config.lakeSourceSystem, "woodward_studio_docs");
  assert.equal(config.identityManifest, flags["identity-manifest"]);
  assert.equal(config.chunkManifest, flags["chunk-manifest"]);
  assert.throws(() => buildKnowledgeSyncConfig({ ...flags, "mirror-root": "relative" }), /absolute remote path/);
});
