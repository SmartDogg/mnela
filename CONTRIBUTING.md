# Contributing to Mnela

Thanks for thinking about contributing. This file is intentionally short
— the project is pre-1.0 and the API surface is still moving. Read it
before opening a PR.

## Before you start

1. **Check [`docs/dev/PLAN.md`](./docs/dev/PLAN.md)** for the phase plan.
   If your idea fits the current phase or one of the explicit Phase 11
   backlog items, you're aligned. If not, please open an issue first to
   discuss scope.
2. **Read [`docs/dev/DECISIONS.md`](./docs/dev/DECISIONS.md)** (ADR log)
   for architectural choices. If your change touches an ADR's stated
   decision, propose an updated ADR in the same PR.
3. **Look at [`docs/dev/ORIGINAL_TZ.md`](./docs/dev/ORIGINAL_TZ.md)** for
   the original technical spec. Amendments are pointed to ADRs; the spec
   itself is preserved as the north star.

## Development setup

```bash
git clone https://github.com/SmartDogg/mnela
cd mnela
cp .env.example .env       # tweak POSTGRES_PASSWORD, REDIS_PASSWORD, COOKIE_SECRET
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d postgres redis
pnpm --filter @mnela/db db:migrate
pnpm --filter @mnela/db db:seed
pnpm dev                   # api :3000, web :3001, worker, orchestrator
# open http://localhost:3001/setup
```

Required: Node 22 LTS, pnpm 10+, Docker. Optional: Claude Code CLI (for
the built-in provider).

## Coding conventions

The `CLAUDE.md` at the repo root is the authoritative style guide. The
short version:

- **TypeScript strict**, no `any`, no implicit unknowns.
- **Atomic commits**, conventional-commits style (`feat(api): …`,
  `fix(web): …`, `docs: …`, `chore: …`, `refactor: …`, `test: …`,
  `ci: …`). The commit-msg hook (`commitlint`) enforces this.
- **No `Co-Authored-By: Claude`** lines in commit messages.
- Tests live next to the code under `__tests__/` (vitest). Integration
  tests under `apps/<app>/test/integration/` (testcontainers postgres +
  redis).
- AI calls go through `@mnela/llm-providers` only — never `streamClaude`
  / `runClaude` directly from app code (see ADR-0049).
- User-tunable settings live in `packages/core/src/system-registry.ts`,
  not env vars (see CLAUDE.md "SystemConfig & hot-reload").

## Pull request flow

1. Fork + branch (`feature/short-name` or `fix/short-name`).
2. Make the change. Keep commits atomic and the PR focused on one
   concern.
3. Run locally:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   ```
4. Open the PR. Use the template in `.github/PULL_REQUEST_TEMPLATE.md`.
5. CI must be green (`.github/workflows/ci.yml`: lint, typecheck,
   tests, docker-build smoke).
6. Wait for review. We'll suggest changes inline; please don't
   force-push during active review — squash at merge time instead.

## Architecture changes

If your change is more than ~50 LOC of structural code (new module,
new endpoint that other consumers will call, new ADR-worthy decision):
add a fresh `ADR-NNNN` entry to `docs/dev/DECISIONS.md` in the same PR. The
template at the bottom of that file shows the structure.

## What doesn't get merged

- Marketing copy in `README.md` or anywhere user-facing.
- Comments that just narrate what the code does (the names should).
- "Helpful" abstractions for hypothetical future requirements.
- Direct LLM-API calls outside `@mnela/llm-providers`.
- New mandatory env variables for things that should live in
  SystemConfig.
- Changes that break `pnpm dev` to make `docker compose --profile prod`
  prettier (both paths must work).

## License

By contributing you agree your code is released under MIT (see
`LICENSE`).
