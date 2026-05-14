# `infra/claude`

Static configuration consumed by the server-side `claude` CLI.

## Files

- `CLAUDE.md.template` — installed at `~/.claude/CLAUDE.md` on the Mnela server
  by `scripts/install.sh`. Sets the global behavior, confidence rubric, task
  types, and anti-patterns for the enrichment loop.
- `claude-mcp-config.json` — **reference template only**. The live MCP config
  is generated at orchestrator boot by
  `apps/orchestrator/src/mcp/mcp-config.boot.ts` and written to
  `${MNELA_DATA_DIR}/claude/claude-mcp-config.json` with the resolved host
  paths and env values for _this_ install. Both `pnpm dev` and the prod
  Docker image use the generated file; this template just documents the
  shape and the env placeholders Mnela substitutes (`${MNELA_STDIO_HOST_PATH}`,
  `${MNELA_VAULT_DIR}`, `${DATABASE_URL}`, `${REDIS_URL}`, `${MNELA_DATA_DIR}`).

## How the orchestrator invokes Claude at runtime

```bash
claude -p "<task>" \
  --add-dir "${MNELA_VAULT_DIR}" \
  --mcp-config "${MNELA_DATA_DIR}/claude/claude-mcp-config.json" \
  --output-format stream-json --verbose --include-partial-messages \
  --dangerously-skip-permissions
```

## Production `claude login`

In Docker, the `claude` binary lives inside `mnela-orchestrator` and its
OAuth credentials persist via a named volume mounted at
`/home/mnela/.claude`. Bootstrap once:

```bash
docker exec -it mnela-orchestrator claude login
```

The login URL Anthropic prints is browser-visited on your workstation, not
the server. After the OAuth flow finishes, `.credentials.json` lands in the
mounted volume and survives `docker compose down/up` cycles. Token refresh
is automatic on subsequent `claude -p` calls.

If you'd rather skip the interactive login (CI / headless deploys), run
`claude setup-token` once on a workstation, copy the resulting token, and
inject it into the orchestrator as `CLAUDE_CODE_OAUTH_TOKEN`. No volume
needed.
