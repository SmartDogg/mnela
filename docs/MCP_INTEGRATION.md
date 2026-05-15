# MCP integration

This guide shows how to connect an MCP-capable client (Claude Code CLI, Cursor, Cline) to a running Mnela instance. It covers token issuance, per-client setup, the recommended `~/.claude/CLAUDE.md` snippet, and the tools you should expect to see once connected.

## Prerequisites

- A running Mnela instance with the `mcp` service reachable. Default port is `3010`; in production it is typically proxied behind Caddy at `https://<your-host>/mcp`.
- Admin access to the Mnela Web UI to issue an MCP token.
- One of:
  - Claude Code (CLI)
  - Cursor
  - Cline (VS Code extension)

## Issue an MCP token

1. Sign in to the Web UI as admin.
2. Navigate to `/admin/system` → the **API tokens** card.
3. Click **Issue token** and choose a scope:
   - `read_only` — read tools only (queries, lookups).
   - `mcp` — read + write (default for Claude Code; covers note-saving, decisions, entity/link writes).
   - `admin` — everything, including `mnela_trigger_enrichment`, `mnela_rebuild_index`, `mnela_export_vault`.
4. Copy the token. It is shown **once** and has the form `mn_<base64url>`. Only the SHA-256 hash is stored in the database — the plaintext is unrecoverable. Store it in your password manager.
5. Revoking a token via the same UI takes effect on the next request — the MCP server verifies tokens against the DB on every call (no cache).

## Claude Code

Add the server with `claude mcp add`. Use the `--scope user` flag so the entry persists across projects.

Production (Mnela behind Caddy with TLS):

```bash
claude mcp add --scope user --transport http mnela \
  https://mnela.example.com/mcp \
  --header "Authorization: Bearer mn_token_xxxxxxxxxxxxxxxxxxxxx"
```

Local development (Mnela running on the same machine):

```bash
claude mcp add --scope user --transport http mnela \
  http://localhost:3010/mcp \
  --header "Authorization: Bearer mn_token_xxxxxxxxxxxxxxxxxxxxx"
```

Verify:

```bash
claude mcp list
# Expected: mnela (http) ✓ Connected
```

Inside a Claude Code session, `> /mcp` should list tools whose names start with `mnela_` (e.g. `mnela_search`, `mnela_get_project_context`, `mnela_save_note`, …).

## Cursor

Edit `~/.cursor/mcp.json` on macOS/Linux, or `%USERPROFILE%\.cursor\mcp.json` on Windows. Add a `mnela` entry under `mcpServers`:

```json
{
  "mcpServers": {
    "mnela": {
      "url": "http://localhost:3010/mcp",
      "headers": {
        "Authorization": "Bearer mn_token_xxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Restart Cursor. The server appears under **Settings → MCP**, and tools are available to the agent.

## Cline

In VS Code, open the Cline panel, then **Settings → MCP Servers → Add server**. Configure:

- **Name:** `mnela`
- **Transport:** `streamable-http`
- **URL:** `http://localhost:3010/mcp` (or your production URL)
- **Headers:** `Authorization: Bearer mn_token_xxxxxxxxxxxxxxxxxxxxx`

Save. Cline reloads the server and the `mnela_*` tools appear in the tool list.

## Recommended `~/.claude/CLAUDE.md` snippet

Append the block below to your global `~/.claude/CLAUDE.md` so Claude Code knows when to reach for Mnela:

```markdown
## My Personal Brain

I have access to my personal knowledge base via the `mnela` MCP server.
Use it whenever:

- I mention "my notes", "my decisions", "we discussed", "remember when"
- Starting a project that may have prior context
- I ask "have I worked on something similar"

Workflow:

1. Always start with `mnela_search` for query terms
2. If a project is identified, fetch `mnela_get_project_context`
3. Cite document IDs in your reasoning
```

## Available tools

Names match TZ §5 verbatim. See the spec for full input/output schemas.

### Read (`read_only`, `mcp`, `admin`)

| Tool                        | Purpose                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `mnela_search`              | Full-text + vector search across documents with filters.       |
| `mnela_get_document`        | Fetch a single document by id.                                 |
| `mnela_get_chunks`          | Fetch the chunked content of a document.                       |
| `mnela_list_projects`       | List all projects.                                             |
| `mnela_get_project_context` | Project + recent docs + decisions + entities + open questions. |
| `mnela_get_decisions`       | Decisions, optionally scoped to a project.                     |
| `mnela_find_similar`        | Find documents semantically similar to a piece of text.        |
| `mnela_get_entity`          | Entity details with linked documents and graph edges.          |
| `mnela_traverse_graph`      | Walk the knowledge graph from a starting entity.               |
| `mnela_get_daily_note`      | Daily note for a given date.                                   |
| `mnela_recent_activity`     | Documents, decisions, and notes from the last N days.          |

### Write (`mcp`, `admin`)

| Tool                           | Purpose                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `mnela_save_note`              | Persist a note as a document.                             |
| `mnela_save_decision`          | Persist a decision attached to a project.                 |
| `mnela_add_entities`           | Attach entities (with merging) to a document.             |
| `mnela_add_links`              | Add graph edges; confidence routes auto-accept vs review. |
| `mnela_update_project_context` | Replace a project's `context.md`.                         |
| `mnela_archive_document`       | Soft-archive a document.                                  |

### Admin (`admin` only)

| Tool                       | Purpose                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `mnela_trigger_enrichment` | Enqueue an `enrich-document` job; returns the BullMQ job id. |
| `mnela_rebuild_index`      | Rebuild search/vector indexes; returns the job id.           |
| `mnela_export_vault`       | Export the markdown vault to disk; returns the export path.  |

## Troubleshooting

- **`401 Unauthorized`** — Token is missing, malformed, or has been revoked. Re-issue via `/admin/system` → API tokens and update your client config.
- **`403 Forbidden`** (or `scope insufficient` in the MCP error body) — The token's scope is too low for the tool you called. Use `mcp` for write tools, `admin` for admin tools.
- **"Tool not found" in the client** — The client cached an old tool list. Re-add the server, e.g. `claude mcp remove mnela && claude mcp add ...`. For Cursor/Cline, restart the editor.
- **SSL errors with a self-signed Caddy cert** — Trust the cert in your OS keystore, or point your client at `http://localhost:3010/mcp` while on the same host.
- **`Connection refused`** — The `mcp` service isn't reachable. Check that it's up:
  ```bash
  docker compose ps mcp
  curl http://localhost:3010/health
  ```
  Expected health response: `{"status":"ok"}`.

## References

- TZ §5 — canonical tool catalogue with input/output schemas.
- [`dev/DECISIONS.md`](./dev/DECISIONS.md) ADR-0030 — Streamable HTTP transport on `POST /mcp`.
- [`dev/DECISIONS.md`](./dev/DECISIONS.md) ADR-0031 — same-transaction audit for write/admin tools.
- [`dev/DECISIONS.md`](./dev/DECISIONS.md) ADR-0032 — `mnela_trigger_enrichment` enqueue + Dumb Mode handling.
- [`dev/DECISIONS.md`](./dev/DECISIONS.md) ADR-0033 — Bearer-only auth, per-call DB verify.
- [`dev/DECISIONS.md`](./dev/DECISIONS.md) ADR-0034 — `mnela_<verb>_<target>` snake_case naming.
