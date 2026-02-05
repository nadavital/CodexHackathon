# Mastra Orchestration Scaffold

This folder contains a minimal workflow-orchestration layer for memory background jobs.

## Scope

- Keeps memory business logic in `src/memoryService.js`.
- Uses Mastra workflows for orchestration and scheduling.
- Supports explicit organizer and consolidator agent decisioning with deterministic write tools.

## Files

- `schemas.js`: Zod schemas for agent decisions and deterministic apply contracts.
- `agents.js`: extractor/organizer/consolidator agents with structured output.
- `tools.js`: deterministic read/apply tool wrappers into `src/memoryService.js`.
- `workflows.js`: extraction + organizer + consolidator pipelines.
- `index.js`: Mastra instance registration for agents and workflows.

## Local Setup (next step)

1. Install dependencies:

```bash
npm i @mastra/core zod
```

2. Add Inngest integration when ready (for scheduled cron execution):
- expose `/api/inngest` from Mastra server
- run Inngest dev server pointing to that endpoint

3. Keep fallback in-process timers available for demo reliability.

## Safety Model

- Agents only return schema-validated structured decisions.
- Agents do not write to SQLite directly.
- All writes happen in deterministic service methods:
  - `applyExtractedMemories`
  - `applyOrganizerDecisions`
  - `applyConsolidatorAliasProposals`
- Extraction requires GPT model access (`OPENAI_API_KEY`) and fails fast when unavailable.
- Alias proposals default to inactive (`is_active = 0`) for review-first behavior.

## Notes

- Current scaffold is intentionally lightweight.
- It does not replace current server startup paths.
- It is safe to iterate without affecting existing note search/chat APIs.
