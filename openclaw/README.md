# OpenClaw Integration Prep

This project includes an OpenClaw-ready command bridge that calls the same service layer used by the web app and MCP server.

## Bridge command

```bash
node openclaw/bridge.js <tool_name> '<json_args>'
```

Example:

```bash
node openclaw/bridge.js project_memory_search '{"query":"launch risks"}'
```

## Included tool names

- `project_memory_search`
- `project_memory_save`
- `project_memory_recent`
- `project_memory_context`
- `project_memory_ask`

## Manifest

`openclaw/tools.manifest.json` documents tool names and JSON schemas so you can map them into your OpenClaw plugin/config quickly.
