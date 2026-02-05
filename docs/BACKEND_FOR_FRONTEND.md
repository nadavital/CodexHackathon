# Backend Guide for Frontend Builders

This doc explains how data flows through the backend and which interfaces you can use from a frontend.

## 1) End-to-end data flow (preprocess -> memory -> store)

### Capture input
Frontend submits notes/files to `POST /api/notes`.

Supported input shapes:
- Plain note text (`content`)
- Link (`sourceType: "link"`, `sourceUrl`)
- Image/file upload as Data URL (`fileDataUrl`), with `fileName` and `fileMimeType`

### Preprocessing
In `createMemory(...)` (`/src/memoryService.js`):
1. Normalizes source type (`text | link | image | file`).
2. If a file/image is uploaded, parses Data URL (`data:<mime>;base64,<bytes>`).
3. For images, stores binary in `/data/uploads/...` and keeps public path (`/uploads/<file>`).
4. For all uploaded files, runs `convertUploadToMarkdown(...)` to produce:
   - `rawContent`
   - `markdownContent`
   - enrichment hints (`summary`, `tags`, `project`)
5. If `content` is missing, uses markdown/raw extraction as fallback content.

### Memory enrichment
Still inside `createMemory(...)`:
1. Creates initial note row in SQLite.
2. Enriches metadata (`summary`, `tags`, `project`) via OpenAI when available; otherwise heuristics.
3. Builds embedding for retrieval (`createEmbedding` or pseudo fallback).
4. Updates the same note row with enrichment + embedding metadata.

### Consolidated memory markdown update
If note came from an upload (`fileDataUrl` present):
1. Appends/merges into a single consolidated markdown file.
2. File is sectioned by user-aspect buckets (Projects & Work, People & Relationships, etc.).
3. Dedupes by `note_id` so the same note is not appended twice.

Default file:
- `/data/consolidated-memory.md` (configurable with `CONSOLIDATED_MEMORY_MARKDOWN_FILE`)

## 2) Storage model

### Notes DB
Primary DB: `/data/project-memory.db`
Table: `notes`

Important columns:
- `id` (TEXT, PK)
- `content` (TEXT)
- `source_type` (TEXT)
- `source_url` (TEXT)
- `image_path` (TEXT)
- `file_name` (TEXT)
- `file_mime` (TEXT)
- `file_size` (INTEGER)
- `raw_content` (TEXT)
- `markdown_content` (TEXT)
- `summary` (TEXT)
- `tags_json` (TEXT JSON array)
- `project` (TEXT)
- `embedding_json` (TEXT JSON array)
- `metadata_json` (TEXT JSON object)
- `created_at`, `updated_at` (ISO strings)

### Tasks DB
Task DB: `/data/tasks.db`
Table: `tasks`
- `id`, `title`, `status`, `created_at`

### File storage
Uploaded binaries are written to:
- `/data/uploads/<uuid>.<ext>`
Served publicly via:
- `GET /uploads/<filename>`

## 3) HTTP API reference (for web/mobile frontend)

Base URL: `http://localhost:<PORT>` (default from `.env`)

### Health
`GET /api/health`
- Returns server health, time, OpenAI configured flag.

### Notes search/list
`GET /api/notes?query=<q>&project=<project>&limit=<n>`
- With `query`: semantic-ranked memory search.
- Without `query`: recent notes.
- Response: `{ items: [{ rank, score, note }], count }`

### Recent notes
`GET /api/recent?limit=<n>`
- Response: `{ items: [note], count }`

### Projects
`GET /api/projects`
- Response: `{ items: [projectName], count }`

### Save note / upload
`POST /api/notes`
Request JSON:
```json
{
  "content": "optional text",
  "sourceType": "text",
  "sourceUrl": "",
  "fileDataUrl": "data:application/pdf;base64,....",
  "fileName": "paper.pdf",
  "fileMimeType": "application/pdf",
  "project": "Research"
}
```
Response:
- `201 { note: {...} }`

### Grounded Q&A
`POST /api/chat`
Request:
```json
{ "question": "What did I learn about X?", "project": "", "limit": 6 }
```
Response:
- `{ answer, citations, mode }`

### Context brief
`POST /api/context`
Request:
```json
{ "task": "Prepare weekly summary", "project": "", "limit": 8 }
```
Response:
- `{ context, citations, mode }`

### Tasks list
`GET /api/tasks?status=open`
- Response: `{ items: [task], count }`

### Tasks create
`POST /api/tasks`
Request:
```json
{ "title": "message ashna", "status": "open" }
```
Response:
- `201 { task }`

## 4) MCP tool surface (for OpenClaw/agents)

Server file: `/mcp/server.js`

Current tools:
- `project_memory_search`
- `project_memory_search_raw_content`
- `project_memory_get_raw_content`
- `project_memory_read_extracted_markdown`
- `project_memory_save`
- `project_memory_recent`
- `project_memory_context`
- `project_memory_ask`
- `project_memory_tasks_list_open`

Legacy `personio_*` aliases are accepted for compatibility.

Use MCP when building agent integrations; use HTTP `/api/*` for frontend UI.

## 5) Frontend integration notes

### Sending uploads correctly
Send uploads as Data URL strings in JSON (`fileDataUrl`).
Format must be:
- `data:<mime-type>;base64,<base64-bytes>`

Backend behavior:
1. Decodes base64 to bytes.
2. Extracts raw + markdown text.
3. Stores extraction in SQLite (`raw_content`, `markdown_content`).
4. Updates consolidated memory markdown for uploaded items.

### Recommended frontend tabs
- Memory tab: `/api/notes`, `/api/chat`, `/api/context`
- Tasks tab: `/api/tasks`
- Optional inspector: show `rawContent` and `markdownContent` from note payloads

## 6) Useful local run commands

- Web server: `npm run dev`
- MCP server: `npm run dev:mcp`
- MCP smoke test: `npm run test:mcp-client`
