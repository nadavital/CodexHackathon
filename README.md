# Project Memory (Hackathon MVP)

AI-powered personal project memory with:

- Web UI for capture/search/chat
- Local SQLite database (single-user, no auth)
- OpenAI enrichment + embeddings (with heuristic fallback)
- MCP stdio server for Codex/ChatGPT tool access
- OpenClaw command-tool bridge

## Why this architecture

- Fast to ship in hackathon time
- Local-first persistence (no cloud setup required)
- One shared service layer feeds web + MCP + OpenClaw

## Project structure

- `src/server.js`: web server + API + static UI hosting
- `src/memoryService.js`: save/search/context/chat/file extraction logic
- `src/openai.js`: Responses + Embeddings API wrappers
- `src/db.js`: SQLite schema + repository
- `src/tasksDb.js`: local tasks table/repository
- `mcp/server.js`: MCP stdio server exposing memory tools
- `openclaw/bridge.js`: command bridge for OpenClaw tools
- `openclaw/tools.manifest.json`: OpenClaw tool schema reference

## Quick start

1. Create `.env` from `.env.example`.
2. Set `OPENAI_API_KEY` (optional).
3. Start web app:

```bash
npm run dev
```

4. Open `http://localhost:8787`.

## MCP server (Codex/ChatGPT)

Run:

```bash
npm run start:mcp
```

Canonical tools:

- `project_memory_search`
- `project_memory_search_raw_content`
- `project_memory_get_raw_content`
- `project_memory_read_extracted_markdown`
- `project_memory_save`
- `project_memory_recent`
- `project_memory_context`
- `project_memory_ask`
- `project_memory_tasks_list_open`

Legacy aliases (`personio_*`) are still accepted for compatibility.

Example Codex MCP config snippet:

```json
{
  "mcpServers": {
    "project-memory": {
      "command": "node",
      "args": ["/absolute/path/to/Hackathon/mcp/server.js"]
    }
  }
}
```

## OpenClaw integration prep

Run a tool directly:

```bash
node openclaw/bridge.js project_memory_search '{"query":"onboarding plan"}'
```

Manifest is at `openclaw/tools.manifest.json`.

## API endpoints

- `GET /api/health`
- `GET /api/notes?query=&project=&limit=`
- `POST /api/notes` (body: `content`, `sourceType`, `sourceUrl`, `imageDataUrl`, `fileDataUrl`, `fileName`, `fileMimeType`, `project`)
- `POST /api/chat` (body: `question`, `project`, `limit`)
- `POST /api/context` (body: `task`, `project`, `limit`)
- `GET /api/projects`
- `GET /api/recent?limit=`
- `GET /api/tasks?status=open`
- `POST /api/tasks` (body: `title`, `status`)

## Notes on input types

- UI supports text/link/image/file capture.
- File/image uploads are sent as Data URLs and stored in note metadata.
- With `OPENAI_API_KEY`, uploads are parsed into `raw_content` + `markdown_content`.
- Without `OPENAI_API_KEY`, uploads still save, and text-like files use a local text extraction fallback.
- Binary uploads are saved with metadata and can still be cited/search-ranked via note content/summary/project/tags.
- Image binaries are stored under `data/uploads/`.

## Helpful scripts

- `npm run test:mcp-client`: MCP smoke test client
- `npm run import:keep -- /path/to/Takeout`: import Google Keep JSON exports

## Demo flow

1. Save a mix of note + link + screenshot/file.
2. Show auto summary/tags/project assignment.
3. Ask a grounded question and show citations.
4. Call the same memory tools via MCP and OpenClaw.
