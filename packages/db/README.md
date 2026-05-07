# @mnela/db

Prisma schema, repositories, and migrations.

## First-time setup

After `pnpm install` at the repo root, with Postgres running (`pnpm dev:db:up`):

```bash
# 1. Generate the Prisma client
pnpm --filter @mnela/db db:generate

# 2. Generate the initial migration from schema.prisma
pnpm --filter @mnela/db exec prisma migrate dev --name init

# 3. Generate an empty follow-up migration for FTS / extensions
pnpm --filter @mnela/db exec prisma migrate dev --create-only --name fts_extensions

# 4. Copy prisma/sql/fts_extensions.sql into the new migration's migration.sql
#    (path printed by step 3, e.g. prisma/migrations/20260507_fts_extensions/)

# 5. Apply the FTS migration
pnpm --filter @mnela/db exec prisma migrate dev

# 6. Seed sample data
pnpm --filter @mnela/db db:seed
```

After this initial setup, all generated migrations live in `prisma/migrations/` and ship with the repo. Subsequent dev environments only need:

```bash
pnpm --filter @mnela/db db:migrate
pnpm --filter @mnela/db db:seed
```

## Available scripts

| Script              | Purpose                                                  |
| ------------------- | -------------------------------------------------------- |
| `db:generate`       | Regenerate Prisma Client after schema changes            |
| `db:migrate`        | Run `prisma migrate dev` (interactive, dev environments) |
| `db:migrate:deploy` | Apply pending migrations (production / CI)               |
| `db:studio`         | Launch Prisma Studio at `http://localhost:5555`          |
| `db:reset`          | Drop and recreate the DB (dev only — destroys data)      |
| `db:seed`           | Run `prisma/seed.ts`                                     |
