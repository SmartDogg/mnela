# @mnela/api

Phase 1 — REST API + DB layer.

## Run

```bash
# from repo root
pnpm dev:db:up                              # postgres on :5433, redis on :6380
pnpm --filter @mnela/db db:migrate:deploy   # apply schema
pnpm --filter @mnela/api dev                # tsx watch on :3000
```

Swagger UI: <http://localhost:3000/api/docs>.

## Required env vars

See [`/.env.example`](../../.env.example). Key variables:

| Var                       | Default            | Notes                                              |
| ------------------------- | ------------------ | -------------------------------------------------- |
| `DATABASE_URL`            | (required)         | Postgres connection string                         |
| `REDIS_URL`               | (required)         | Redis connection string (sessions live here)       |
| `COOKIE_SECRET`           | dev placeholder    | rotate to invalidate all sessions                  |
| `SESSION_TTL_SECONDS`     | 604800             | 7 days                                             |
| `ADMIN_INITIAL_USERNAME`  | (optional)         | bootstraps the first admin if `AdminUser` is empty |
| `ADMIN_INITIAL_PASSWORD`  | (optional)         | min 12 chars                                       |
| `HTTP_PORT` / `HTTP_HOST` | `3000` / `0.0.0.0` |                                                    |
| `MNELA_LOG_LEVEL`         | `info`             | pino level                                         |
| `MNELA_DATA_DIR`          | `./data`           | uploads land in `${MNELA_DATA_DIR}/uploads/`       |

## Tests

```bash
pnpm --filter @mnela/api test
```

Boots postgres + redis testcontainers and runs `prisma migrate deploy` against
them before the integration suite. In CI (`CI=true` plus `DATABASE_URL` + `REDIS_URL`
set), reuses the GitHub Actions service containers instead.
