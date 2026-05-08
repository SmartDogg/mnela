# `infra/claude`

Static configuration consumed by the server-side `claude` CLI.

## Files

- `CLAUDE.md.template` — installed at `~/.claude/CLAUDE.md` on the Mnela server
  by `scripts/install.sh` (Phase 10). Sets the global behavior, confidence
  rubric, task types, and anti-patterns for the enrichment loop.
- `claude-mcp-config.json` — example MCP config for the server-side Claude. The
  installer copies it to `/etc/mnela/claude-mcp-config.json` after substituting
  `${DATABASE_URL}` and `${REDIS_URL}`. `MNELA_CLAUDE_MCP_CONFIG` env var on the
  orchestrator points at the resolved path.

The orchestrator passes both at runtime:

```bash
claude -p "<task>" \
  --add-dir /var/lib/mnela/vault \
  --mcp-config /etc/mnela/claude-mcp-config.json \
  --output-format stream-json --verbose --include-partial-messages \
  --dangerously-skip-permissions
```
