# Exporting from ChatGPT

ChatGPT's own export covers every conversation, the user profile, and a
rendered HTML mirror — Mnela's parser unpacks the whole ZIP and treats
each conversation as a separate `Document(source=chatgpt_export)`.

## Get the export

1. Open ChatGPT → top-right avatar → **Settings**.
2. **Data Controls** → **Export Data**.
3. Confirm. ChatGPT emails a download link within minutes; the link is
   valid for 24 hours.
4. Download the ZIP. Keep it zipped — don't decompress.

## Upload to Mnela

Mnela accepts the ZIP as-is. Either:

- **Web UI:** `/activity?tab=uploads` → "Upload" → drop the ZIP. The parser
  finds `conversations.json` inside and starts a job. Progress streams
  live; entities + edges land on `/graph` as enrichment finishes.
- **Folder watch:** drop the ZIP into `${MNELA_DATA_DIR}/dropbox/`. The
  worker picks it up within ~1 second.
- **API:** `POST /api/v1/imports` with the file (multipart/form-data,
  field `file`). Requires a bearer token of scope `mcp` or `admin`.

## What's inside the ZIP

| File                     | Used by Mnela?                                      |
| ------------------------ | --------------------------------------------------- |
| `conversations.json`     | Yes — primary source, one Document per conversation |
| `chat.html`              | No (redundant with `conversations.json`)            |
| `user.json`              | No (personally identifiable, intentionally ignored) |
| `message_feedback*.json` | No                                                  |

Idempotent: re-uploading the same ZIP doesn't dupe. Mnela dedups via
`content_hash = sha256(source::conversationId::rawText)`.

## Tips

- ChatGPT free / Plus / Team / Enterprise all produce the same ZIP shape.
- Custom GPTs aren't in the export. Conversations _with_ custom GPTs are.
- Image attachments in conversations get materialised as `Attachment` rows
  if a vision provider is configured (`/admin/system → AI Providers →
vision`).
