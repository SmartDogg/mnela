# Security Policy

## Supported versions

Mnela is currently pre-1.0 — only the latest `v*` release tag and the
`main` branch are receiving security updates. Once a `v1.0.0` ships,
this section will list a support matrix.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.
Instead, file a private advisory:

1. Open <https://github.com/SmartDogg/mnela/security/advisories/new> and
   describe the issue.
2. If GitHub's advisory flow doesn't work for you, email the maintainer
   at the address listed in the GitHub profile.

Expect an acknowledgement within 7 days. Once a fix is ready we'll
coordinate disclosure timing with you (typically 30–90 days for
non-actively-exploited issues, faster for high-severity in-the-wild
problems).

## Scope

In scope:

- The Mnela monorepo at <https://github.com/SmartDogg/mnela> (all `apps/`
  and `packages/`).
- The official deployment artefacts: `scripts/install.sh`,
  `scripts/{backup,restore,update}.sh`, `infra/docker/Dockerfile.*`,
  `infra/caddy/Caddyfile.*.template`, the GHCR images published by
  `.github/workflows/release.yml`.

Out of scope:

- Misconfiguration of a self-hosted instance (weak admin password, open
  `MNELA_INTERNAL_TOKEN`, leaked `.env`, etc.).
- Third-party providers Mnela talks to (Anthropic, OpenAI, Telegram).
- Denial-of-service via unauthenticated abuse — Mnela is single-tenant
  by design and is expected to sit behind a reverse proxy + access
  control.

## What we care about

- Authentication bypass (`/auth/bootstrap`, `/auth/login`, session
  forging, MCP bearer-token validation).
- Authorization escalation across scopes (`read_only` → `mcp` →
  `admin`).
- Plaintext exposure of `LlmProvider.apiKeyEnc` or
  `TelegramBot.tokenEnc` (the keystore mechanism is supposed to make
  these unreadable without the master key — see ADR-0049).
- SQL injection through any controller / MCP tool input that hits
  Prisma `$queryRaw`.
- SSRF / RCE in the ingestion pipeline (parsers for ZIP / PDF / DOCX /
  audio / images).
- Path traversal in `/documents/upload`, `/imports`, or the dropbox
  watcher.
- Container escape from a built image (we run as `mnela` non-root user
  inside `node:22-slim`; deviations from that pattern are interesting).

## Public-disclosure hygiene

Once a fix lands we'll:

- Tag a patch release (`vX.Y.Z+1`).
- Publish a GitHub Security Advisory with credit (if the reporter
  wants it).
- Mention the CVE (if assigned) in the release notes that
  `.github/workflows/release.yml` auto-generates.
