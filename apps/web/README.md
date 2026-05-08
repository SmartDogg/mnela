# @mnela/web

Phase 3 — Next.js 15 web UI.

## Run

```bash
# from repo root
pnpm dev:db:up
pnpm --filter @mnela/api dev      # http://localhost:3000
pnpm --filter @mnela/web dev      # http://localhost:3001
```

Set `ADMIN_INITIAL_USERNAME` / `ADMIN_INITIAL_PASSWORD` in the API `.env` so
`/login` has a working account.

## Env

| Var                       | Default                        | Notes                                   |
| ------------------------- | ------------------------------ | --------------------------------------- |
| `MNELA_API_ORIGIN`        | `http://localhost:3000`        | Used by `next.config.ts` rewrites.      |
| `MNELA_API_INTERNAL_BASE` | `http://localhost:3000/api/v1` | Used by server components for /auth/me. |

## Scripts

```bash
pnpm --filter @mnela/web dev        # next dev
pnpm --filter @mnela/web build      # next build
pnpm --filter @mnela/web typecheck
pnpm --filter @mnela/web lint
pnpm --filter @mnela/web test       # vitest
pnpm --filter @mnela/web test:e2e   # playwright (boots dev server)
pnpm --filter @mnela/web codegen:api  # regenerate src/lib/api/schema.ts (ADR-0019)
```
