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
- `src/memoryService.js`: save/search/context/chat logic
- `src/openai.js`: Responses + Embeddings API wrappers
- `src/db.js`: SQLite schema + repository
- `mcp/server.js`: MCP stdio server exposing memory tools
- `openclaw/bridge.js`: command bridge for OpenClaw tools
- `openclaw/tools.manifest.json`: OpenClaw tool schema reference

## Quick start

1. Create `.env` from `.env.example`.
2. Set `OPENAI_API_KEY` (optional; app still runs in heuristic mode).
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

This exposes tools:

- `project_memory_search`
- `project_memory_save`
- `project_memory_recent`
- `project_memory_context`
- `project_memory_ask`

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

The manifest at `openclaw/tools.manifest.json` describes tool schemas for plugin wiring.

## API endpoints

- `GET /api/health`
- `GET /api/notes?query=&project=&limit=`
- `POST /api/notes` (body: `content`, `sourceType`, `sourceUrl`, `imageDataUrl`, `fileDataUrl`, `fileName`, `fileMimeType`, `project`)
- `POST /api/chat` (body: `question`, `project`, `limit`)
- `POST /api/context` (body: `task`, `project`, `limit`)
- `GET /api/projects`
- `GET /api/recent?limit=`

## Notes on input types

- Responses API supports text/image/file inputs.
- The web UI supports text/link plus file uploads (images, PDF, DOCX, and other common office/text formats).
- Every upload is parsed through the OpenAI Responses API into:
  - `raw_content` (plain extraction)
  - `markdown_content` (structured markdown)
  Both are stored in the same SQLite `notes` table.
- URL content still requires app-side fetching/parsing if you want deep page understanding.
- Image uploads are stored locally under `data/uploads/`.
- Upload parsing requires a real `OPENAI_API_KEY` (heuristic mode does not process uploaded files).

## Demo flow

1. Save a mix of note + link + screenshot.
2. Show auto summary/tags/project assignment.
3. Ask a question in grounded chat and show citations.
4. Call the same memory tools via MCP or OpenClaw bridge.
