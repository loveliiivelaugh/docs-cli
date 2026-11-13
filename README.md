# docs-cli

JavaScript CLI for the Docs Pipeline API.

Designed as a lightweight CLI: plain Node.js, ESM modules, no runtime dependencies, local config storage, and JSON-first output that works well for humans and agents.

Current capabilities:

- Store a Docs API key locally for reuse
- Verify auth against the API
- Submit Docling-powered PDF-to-Markdown formatting jobs
- Expose a scaffolded command surface for future CSV-to-HTML conversion
- Submit image extraction, transcription, and render jobs
- Poll job status and fetch artifacts
- Send raw authenticated requests to unsupported endpoints while the CLI grows
- Synchronize allowlisted Markdown into the Guardian Knowledge Atlas and verify retrieval

## Requirements

- Node.js 18 or newer

## Install

Run directly:

```bash
node bin/docs.js help
```

Or link it globally from the project directory:

```bash
npm link
docs help
```

## Authentication

Save an API key and verify it immediately:

```bash
docs auth login --api-key "$DOCS_API_KEY" --base-url http://127.0.0.1:8000
```

Or avoid putting the key in shell history:

```bash
printenv DOCS_API_KEY | docs auth login --api-key-stdin
```

Check saved auth:

```bash
docs auth status
docs auth status --verify
```

Remove saved auth:

```bash
docs auth logout
```

Credentials are stored in the current user’s configuration directory.

Environment overrides:

- `DOCS_API_KEY` overrides the stored key for the current command
- `DOCS_API_BASE_URL` overrides the stored base URL for the current command

## Commands

Current commands:

```bash
docs help
docs auth login --api-key <key>
docs auth status --verify
docs auth logout
docs health
docs format pdf --input-dir <dir> [--output-dir <dir>]
docs format csv-html --input-path <path> [--output-path <path>]
docs convert-pdf --input-dir <dir> [--output-dir <dir>]
docs convert-csv-html --input-path <path> [--output-path <path>]
docs extract-images --input-path <path>
docs transcribe --video-dir <dir>
docs render markdown --input-path <path>
docs render text --input-path <path>
docs jobs status <job_id>
docs jobs wait <job_id>
docs jobs artifacts <job_id>
docs request <method> <path>
docs knowledge sync [--dry-run] [--smoke-query <query>]
```

## PDF Formatting

The main workflow today is Docling-backed PDF-to-Markdown conversion:

```bash
docs format pdf --input-dir ./pdfs --output-dir ./markdown --recursive
```

You can also call the lower-level alias directly:

```bash
docs convert-pdf --input-dir ./incoming --converter docling --force
```

This submits a job and returns JSON like:

```json
{
  "job_id": "abc123",
  "status": "queued"
}
```

Then poll until it finishes:

```bash
docs jobs wait abc123 --interval 2 --timeout 300
docs jobs artifacts abc123
```

## CSV To HTML

The CLI now reserves first-class commands for a lossless CSV-to-HTML workflow:

```bash
docs format csv-html --input-path ./exports/report.csv --output-path ./exports/report.html --preserve-types
docs convert-csv-html --input-path ./table.csv --table-title "Quarterly Report"
```

Right now these commands are scaffolded but intentionally fail until the backend route exists. The recommended API contract is:

```text
POST /v1/jobs/convert-csv-html
```

Suggested request shape:

```json
{
  "input_path": "./exports/report.csv",
  "output_path": "./exports/report.html",
  "table_title": "Quarterly Report",
  "preserve_types": true
}
```

Suggested behavior:

- Preserve every row and column without dropping or reordering fields
- Preserve type information and original textual fidelity
- Emit HTML that keeps the full table structure and metadata intact
- Return job artifacts the same way as the other conversion jobs

## Other Job Types

Extract embedded images:

```bash
docs extract-images --input-path ./docs --recursive --assets-dir-name assets
```

Transcribe videos:

```bash
docs transcribe --video-dir ./videos --output-dir ./transcripts --model whisper-1
```

Render files:

```bash
docs render markdown --input-path ./notes/brief.md
docs render text --input-path ./notes/brief.txt
```

## Knowledge Atlas Sync

Configure the source and remote locations before synchronizing the approved documentation paths. Guardian and lakectl must be available on the remote host’s PATH. The sync updates Guardian’s SurrealDB Knowledge Atlas and runs a lexical retrieval smoke test:

```bash
docs knowledge sync
```

Preview which Markdown, MDX, or text files would be transferred without changing the mirror or index:

```bash
docs knowledge sync --dry-run
```

Use a query related to the document you just added for the smoke test:

```bash
docs knowledge sync \
  --smoke-query "robotics authentication architecture"
```

The command permits only:

- `docs/Infrastructure`
- `docs/Robotics`
- `docs/API`
- `docs/tools`
- `docs/Intelligent-Memory`

Select a subset with repeated `--include-path` flags. Paths outside the allowlist are rejected.

Embeddings remain off by default while the local embedding service on `m4` is unavailable. After that service is restored:

```bash
docs knowledge sync --include-embeddings true
```

Required configuration (each can also be supplied as the corresponding command-line flag):

- `WOODWARD_STUDIO_DOCS_ROOT` (`--repo-root`)
- `DOCS_KNOWLEDGE_MIRROR_ROOT` (`--mirror-root`)
- `DOCS_KNOWLEDGE_LAKE_SOURCES` (`--lake-sources`)
- `DOCS_KNOWLEDGE_IDENTITY_MANIFEST` (`--identity-manifest`)
- `DOCS_KNOWLEDGE_CHUNK_MANIFEST` (`--chunk-manifest`)

Optional environment overrides:
- `DOCS_KNOWLEDGE_HOST`
- `DOCS_KNOWLEDGE_SOURCE_KEY`
- `DOCS_KNOWLEDGE_SMOKE_QUERY`

## Raw Requests

The `request` command is the escape hatch for endpoints not wrapped yet:

```bash
docs request GET /healthz
docs request GET /v1/jobs/abc123
docs request POST /v1/jobs/convert-pdf --data '{"input_dir":"./pdfs","output_dir":"./markdown"}'
docs request POST /v1/jobs/render-markdown --input ./payload.json
```

## Notes

- The default base URL is `http://127.0.0.1:8000`
- `docs auth status --verify` confirms authenticated access by probing a protected jobs endpoint
- The CLI is intentionally JSON-first so agent workflows can parse outputs cleanly
