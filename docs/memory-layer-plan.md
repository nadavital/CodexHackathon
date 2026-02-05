# Memory Layer Feature Plan (Internal Handoff)

Last updated: February 5, 2026
Status: In-progress (extraction-first architecture implemented)
Scope: Internal feature tracking for the memory-layer stream

## Objective

Build a local-first memory layer for consumer users that:

- ingests processed markdown from pipeline (`filename`, `markdown`)
- versions and preserves source evidence over time
- extracts atomic memories (preferences, commitments, decisions, etc.) with agent intelligence
- keeps memory continuously organized (background organizer/consolidator jobs)
- exposes memory via HTTP API, MCP, and OpenClaw
- keeps citations trustworthy and traceable to source/version/offsets

## Core Decisions (Locked)

1. Canonical storage
- Canonical source text is stored in `pm_source_versions` (with optional `agentfs_uri` reference).
- Source metadata is tracked in `pm_sources`.

2. Ingestion contract
- Upstream pipeline sends `filename` + `markdown`.
- Optional: `sourcePath`, `externalSourceId`, `agentfsUri`, `metadata`.

3. Identity policy
- Prefer `externalSourceId` when provided.
- Fallback to hash of normalized filename/path when missing.

4. Memory model
- Source document is evidence, not the final memory unit.
- Extracted memories are atomic and persisted in `pm_memories`.

5. Safety model
- Agents do not write to SQLite directly.
- Agents return schema-validated structured output only.
- Deterministic service/repository methods perform writes.

6. Citation policy
- Every extracted memory should retain citation metadata pointing to source/version and offsets where available.

7. Consolidation policy
- Exact matches can be collapsed deterministically.
- Fuzzy consolidation stays review-first (`pm_source_aliases.is_active = 0` for proposals by default).

8. Scheduling policy
- Hybrid scheduler remains the target:
- Mastra/Inngest primary orchestration.
- In-process fallback acceptable for local reliability.

## Consumer Top-Level Buckets

1. `Preferences`
2. `People`
3. `Commitments`
4. `Decisions`
5. `Knowledge`
6. `Resources`
7. `Events`
8. `Inbox`

## Implemented Data Model

Implemented and active in `src/db.js`:

- `pm_sources`
- `pm_source_versions`
- `pm_memories`
- `pm_categories`
- `pm_memory_categories`
- `pm_related_memories`
- `pm_source_aliases`
- `pm_jobs`
- `pm_job_runs`
- `pm_memory_evidence` (new)
- `pm_extraction_runs` (new)

## Current End-to-End Flow (Implemented)

1. Ingest source evidence
- `ingestProcessedMarkdown()` upserts source and versioned markdown.

2. Extraction run tracking
- Creates `pm_extraction_runs` row with `status=running`.

3. Agent extraction
- Calls Mastra `memoryExtractorAgent` (GPT-5.1) for structured atomic memories.

4. Deterministic persistence
- `applyExtractedMemories()` upserts atomic memories.
- Writes category assignment (`assignment_source=extractor_agent`).
- Writes evidence rows in `pm_memory_evidence`.

5. Cleanup and idempotency
- Legacy document-level memory row (`memory_id == source_id`) is removed.
- Stale extracted memories for the same source are pruned.
- If source checksum is unchanged and extracted memories already exist, extraction is skipped (`extractionSkipped=true`) to avoid LLM drift churn.

6. Extraction run completion
- `pm_extraction_runs` set to success/failure with counts and error text.

## Mastra Layer (Implemented)

Files:
- `mastra/schemas.js`
- `mastra/agents.js`
- `mastra/tools.js`
- `mastra/workflows.js`
- `mastra/index.js`

Agents:
- `memoryExtractorAgent` (new)
- `memoryOrganizerAgent`
- `memoryConsolidatorAgent`

Workflows:
- `memory-extraction-workflow` (new)
- `memory-organizer-workflow`
- `memory-consolidator-workflow`

Deterministic tools:
- `load_source_version_for_extraction`
- `apply_extracted_memories`
- `list_memory_batch`
- `apply_organizer_decisions`
- `apply_consolidator_aliases`

## HTTP/MCP/OpenClaw Surface

HTTP:
- `POST /api/memory/ingest`
- `GET /api/memory/records?limit=`

MCP:
- `project_memory_ingest_processed`
- `project_memory_records`
- plus legacy memory tools

OpenClaw bridge:
- supports same ingest/records operations

## Implementation Progress Log

### Checkpoint 1 - Schema and Repository Foundation (Completed)

- Added `pm_*` foundation tables and repository methods.
- Preserved existing `notes` table and old flows.

### Checkpoint 2 - Ingestion and Versioning API (Completed)

- Added `ingestProcessedMarkdown()` with source/version hashing.
- Added source version creation on checksum change only.

### Checkpoint 3 - API Contract Wiring (Completed)

- Added ingest/list endpoints in `src/server.js`.
- Preserved existing notes/search/chat/context endpoints.

### Checkpoint 4 - MCP/OpenClaw Contract Wiring (Completed)

- Added ingest/list contracts in both integration layers.

### Checkpoint 5 - Organizer/Consolidator Heuristic Jobs (Completed)

- Added runnable organizer/consolidator passes with job-run logs.

### Checkpoint 6 - Mastra Scaffold (Completed)

- Added tools/workflows/index scaffold and scripts (`dev:mastra`, `dev:inngest`).

### Checkpoint 7 - External Identity Policy (Completed)

- Implemented `externalSourceId` preference with filename-hash fallback.

### Checkpoint 8 - Deterministic Persistence for Organizer/Consolidator (Completed)

- Organizer now persists category/link outputs.
- Consolidator now persists alias proposals.

### Checkpoint 9 - Extraction-First Refactor (Completed)

- Removed source-document-as-memory write path for new ingests.
- Added atomic extraction write path with evidence and extraction run logs.
- Removed hardcoded extraction classifier fallback from ingest path.
- Extraction now requires model availability and fails fast otherwise.
- Added idempotency guard to skip re-extraction on unchanged content.

### Checkpoint 10 - Runtime Dependencies (Completed)

- Installed runtime dependencies for Mastra extraction path:
  - `@mastra/core`
  - `zod`

## Validation Snapshot (Latest)

Validated on February 5, 2026:

- `node --check` passes for all touched source and Mastra files.
- Soccer note ingest produced multiple atomic preference memories (not one verbatim document memory).
- `pm_memory_evidence` rows were written with source version references and offsets where available.
- `pm_extraction_runs` rows were written with success status and extracted count.
- Re-ingest of unchanged source skipped extraction via idempotency guard.

## Remaining Open Items

1. Merge-review UX/API
- Add explicit reviewer workflow for alias/merge approvals.

2. Manual edit surface
- API + UI for `title`, `notes`, `pinned_tags`, `category_overrides` on atomic memories.

3. Backfill/migration job
- Reprocess historical source corpus to remove remaining legacy document-memory rows.

4. Inngest production wiring
- Finalize durable scheduling runtime for extraction/organizer/consolidator workflows.

5. Retrieval contract polish
- Expose stronger citation payloads in API/MCP (including evidence rows and offsets directly in response shape).

## Next Execution Order

1. Build backfill command to re-extract all legacy sources into atomic memories.
2. Add merge-review state model and endpoints.
3. Implement manual edit APIs and UI for atomic memories.
4. Wire Inngest execution for scheduled workflows.
5. Update README and deployment docs with extraction-first operational runbook.

## Handoff Notes

- This document is the source of truth for memory-layer planning decisions.
- The current system should be treated as extraction-first for all new pipeline ingests.
- Do not reintroduce direct heuristic source-to-memory conversion in ingest path.
