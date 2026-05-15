# Changelog

All notable changes to Mnela are tracked here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-05-15

First public release. Stack is feature-complete against the original
spec ([`docs/dev/ORIGINAL_TZ.md`](./docs/dev/ORIGINAL_TZ.md)) plus all
post-spec ADRs ([`docs/dev/DECISIONS.md`](./docs/dev/DECISIONS.md)).

### Highlights

- **Ingestion** — streaming ZIP parser, ChatGPT / Claude.ai / Obsidian
  exports, PDFs, Office docs, voice notes, images. Folder watcher
  picks up files dropped into `${MNELA_DATA_DIR}/dropbox/`.
- **Auto knowledge graph** — entity + edge extraction per document with
  confidence-scored link suggestions; low-confidence proposals land in
  `/inbox` for human triage.
- **Ask Brain** — SSE-streamed Q&A with inline citations + tool-call
  timeline. Pin any turn to promote it to a Document.
- **Pluggable LLM providers** ([ADR-0049](./docs/dev/DECISIONS.md#adr-0049--pluggable-llm-provider-abstraction))
  — built-in Claude Code CLI (no API key), Anthropic API, or any
  OpenAI-compatible endpoint. AES-256-GCM-encrypted keystore.
- **Auto-suggested projects** ([ADR-0051](./docs/dev/DECISIONS.md#adr-0051--auto-suggested-projects-post-import-detector--manual-create--ask-scope))
  — post-ingest detector groups related documents into accept/dismiss
  candidates without auto-creating them.
- **MCP server** — Streamable HTTP transport, bearer-token auth, full
  tool catalogue ([`docs/MCP_INTEGRATION.md`](./docs/MCP_INTEGRATION.md)).
- **Telegram bot** ([ADR-0053](./docs/dev/DECISIONS.md#adr-0053--telegram-bot-integration-single-tenant-frontend-over-searchask--documentsupload))
  — single-tenant, multi-modal turn bundling (voice + photo + text in
  one TG thread becomes one `/search/ask` call).
- **One settings sheet** — `/admin/system` is the only admin page. All
  user-tunable settings hot-reload via **Restart Services**, no process
  restart needed.

### Deploy & operate

- One-command VPS install (`curl … install.sh | sudo bash`) with
  interactive TUI for domain / IP / Cloudflare Tunnel choice.
- `mnela` CLI for `status / logs / backup / restore / update`.
- Pre-built multi-arch Docker images on
  `ghcr.io/smartdogg/mnela-{api,web,worker,orchestrator,tg-bot,mcp}`.
- Backup + restore round-trip including the encrypted provider keystore
  (`scripts/{backup,restore}.sh`, validated via AES-GCM before any
  destructive operation).
