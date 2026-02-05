# Memory Layer Onboarding (Teammate Guide)

Last updated: February 5, 2026
Audience: Teammates integrating upstream processing pipeline with this repo

## What This Stack Does

This project ingests processed markdown and turns it into atomic, user-centric memories.

- Source markdown is preserved as evidence with versioning.
- GPT-5 extraction creates atomic memory units (preferences, commitments, decisions, etc.).
- Deterministic write methods persist memories, categories, evidence, and run logs.
- Organizer/consolidator workflows maintain structure and relationship quality over time.

## High-Level Architecture

1. Ingest layer
- HTTP endpoint: `POST /api/memory/ingest`
- Service function: `ingestProcessedMarkdown()`

2. Source storage
- `pm_sources` (identity + metadata)
- `pm_source_versions` (versioned markdown evidence)

3. Extraction intelligence
- Mastra `memoryExtractorAgent` (GPT-5.1)
- Structured output only (Zod)

4. Deterministic persistence
- `applyExtractedMemories()` writes:
- `pm_memories` (atomic memories)
- `pm_memory_categories` (extractor-assigned top-level category)
- `pm_memory_evidence` (source/version/offset evidence)

5. Job tracking
- `pm_extraction_runs` logs run status/count/errors
- `pm_job_runs` logs organizer/consolidator jobs

## Data Model Quick Reference

- `pm_sources`: one row per canonical source identity
- `pm_source_versions`: immutable source versions on content change
- `pm_memories`: extracted atomic memory rows
- `pm_memory_evidence`: citation/evidence per memory
- `pm_memory_categories`: category assignments
- `pm_related_memories`: relationship links
- `pm_source_aliases`: consolidation aliases (review-first)
- `pm_extraction_runs`: extraction run lifecycle

## Pipeline Integration Contract

Send JSON to `POST /api/memory/ingest`:

Required fields:
- `filename` (string)
- `markdown` (string)

Recommended optional fields:
- `externalSourceId` (string): stable upstream identity
- `sourcePath` (string): original path for traceability
- `agentfsUri` (string): optional pointer to canonical artifact in AgentFS
- `metadata` (object): freeform provenance data

Example request:

```bash
curl -X POST http://localhost:8787/api/memory/ingest \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "filename": "personal/soccer_weekend_note.txt",
  "externalSourceId": "research:personal/soccer_weekend_note.txt",
  "sourcePath": "/Users/jimil/Desktop/Research/soccer_weekend_note.txt",
  "markdown": "I like playing soccer but only on the weekends...",
  "metadata": { "createdFrom": "pipeline", "pipelineRunId": "run-123" }
}
JSON
```

## Identity Rules

- If `externalSourceId` is provided:
  - `source_id = ext:<normalized_external_source_id>`
- If missing:
  - `source_id = sha256(normalized filename/path)`

Use stable `externalSourceId` whenever possible.

## Ingest Behavior You Should Expect

1. New or changed source version
- Creates/updates source metadata.
- Writes a new source version when checksum changed.
- Runs extraction and writes atomic memories.

2. Unchanged source version
- If extracted memories already exist and no legacy doc-memory row exists:
- extraction is skipped (`extractionSkipped=true`).

3. Legacy cleanup
- Legacy doc-level memory row (`memory_id == source_id`) is removed once source is reprocessed.

## Runtime Requirements

- Node runtime compatible with project.
- `OPENAI_API_KEY` must be set for extraction.
- Dependencies installed:

```bash
npm install
```

Current key deps:
- `@mastra/core`
- `zod`

## How to Run Locally

Start API server:

```bash
cd /Users/jimil/Projects/CodexHackathon
node src/server.js
```

List recent extracted memories:

```bash
curl 'http://localhost:8787/api/memory/records?limit=20'
```

## Debugging and Verification

Check extraction runs:

```bash
sqlite3 /Users/jimil/Projects/CodexHackathon/data/project-memory.db \
"SELECT run_id, source_id, source_version, model, status, extracted_count, error_text FROM pm_extraction_runs ORDER BY run_id DESC LIMIT 20;"
```

Check extracted memories for a source:

```bash
sqlite3 /Users/jimil/Projects/CodexHackathon/data/project-memory.db \
"SELECT memory_id, effective_summary, json_extract(metadata_json, '$.extractedKind') FROM pm_memories WHERE source_id='ext:research:personal/soccer_weekend_note.txt';"
```

Check evidence rows:

```bash
sqlite3 /Users/jimil/Projects/CodexHackathon/data/project-memory.db \
"SELECT memory_id, source_version, start_offset, end_offset, evidence_text FROM pm_memory_evidence WHERE source_id='ext:research:personal/soccer_weekend_note.txt';"
```

## Integration Guidance for Upstream Team

1. Treat markdown as source evidence, not final memory text.
2. Keep `externalSourceId` stable across reprocesses.
3. Include useful `metadata` (pipeline run id, parser version, etc.).
4. Re-send source on meaningful content changes only.
5. If extraction fails, inspect `pm_extraction_runs.error_text` first.

## Important Guardrails

- Agents do not execute direct SQL writes.
- All writes are deterministic service-layer operations.
- Extraction output is schema-validated before persistence.
- Consolidation aliases remain review-first by default.

## Known Gaps (As of Feb 5, 2026)

- Merge-review UX/API still pending.
- Manual edit APIs/UI for atomic memories still pending.
- Full backfill command for all legacy sources still pending.
- Inngest durable scheduling wiring still pending final integration.
