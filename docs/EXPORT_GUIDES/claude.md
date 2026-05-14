# Exporting from Claude.ai

Claude.ai (the consumer chat product, not Claude Code) gives you a ZIP
with one JSON file per conversation plus all Projects. Mnela parses both
shapes via `packages/ingestion/src/claude.ts`.

## Get the export

1. Claude.ai → top-right avatar → **Settings** → **Privacy**.
2. **Export data**. Anthropic queues the export and emails a link.
3. Link is valid for 24 hours. Save the ZIP somewhere quickly.

## Upload to Mnela

Same three routes as the ChatGPT export:

- Web UI: `/activity?tab=uploads` → drop the ZIP.
- Folder watch: drop into `${MNELA_DATA_DIR}/dropbox/`.
- API: `POST /api/v1/imports`.

## What's inside

A top-level `conversations.json` plus a `projects/` directory. Mnela:

- Creates one `Document(source=claude_export)` per conversation
- Creates one `Project` per Claude.ai project, linking its conversations
  via the `documents` relation (status `active` so it shows up under
  `/projects` right away)
- Materialises attachments (uploaded files, generated images) as
  `Attachment` rows

## Claude Code session JSONL is separate

If you want to ingest YOUR OWN Claude Code sessions (not the chat product),
point a folder watch at `~/.claude/projects/` — the
`claude-code-session.ts` parser handles the JSONL line-by-line format. The
ZIP described above doesn't contain these.

## Dedupe

`content_hash = sha256(source::conversationUuid::rawText)`. Re-uploading
overwrites nothing; duplicate rows aren't created.
