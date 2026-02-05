# Project Memory - Agent Guide

## Project Goal

Build an AI-powered personal project memory tool:

- Users can save anything quickly (text, link, image).
- The system auto-enriches each item (summary, tags, project label).
- Users can ask grounded questions and get answers with citations.
- The same memory is exposed to agents through MCP and OpenClaw tools.

This should feel like an "AI-native Google Keep for project context."

## Hackathon Success Criteria

By demo time, we should be able to show:

1. Capture mixed inputs in the web UI.
2. Automatic AI enrichment after save.
3. Grounded chat answers with citation cards.
4. Codex/ChatGPT access through MCP tools.
5. OpenClaw access through the tool bridge.

## MVP Scope (Current Plan)

- Single-user, local-first setup (no auth).
- Local SQLite database for speed.
- OpenAI as the AI provider for enrichment + embeddings.
- Heuristic fallback mode when `OPENAI_API_KEY` is missing.
- Shared service layer used by:
  - Web app/API
  - MCP server
  - OpenClaw bridge

## Non-Goals for MVP

- Multi-user auth and permissions.
- Cloud deployment hardening.
- Continuous local file watchers.
- Complex enterprise security flows.
- Heavy infra setup before a working demo.

## Product Principles

- One memory backend, multiple agent surfaces.
- Ground answers in saved artifacts and show sources.
- Optimize for fast capture and high demo reliability.
- Keep architecture simple and composable.

## Agent Working Rules

When making changes:

1. Reuse the shared memory service (`src/memoryService.js`) instead of duplicating logic.
2. Keep MCP and OpenClaw tool contracts aligned with web behavior.
3. Preserve local-first defaults and no-auth assumptions.
4. Prioritize demo stability over broad feature expansion.
5. If scope tradeoffs are needed, keep:
   - capture -> enrich -> retrieve -> cite
   - MCP + OpenClaw integration path

## Definition of Done (Hackathon Build)

The build is "done enough" when:

- A new note can be saved and appears in recent memory.
- Search returns relevant results.
- Chat and context generation include citations.
- MCP tools can read/write memory.
- OpenClaw bridge can read/write memory.
- README instructions are accurate and runnable.
