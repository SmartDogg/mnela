# Mnela performance & profiling

A short field guide for keeping Mnela honest on a single VPS. None of
this is fancy — the goal is to be able to answer "is this slow?" with
numbers instead of vibes.

## Baseline RSS (idle, 1 GB VPS)

Numbers to expect after `mnela update` on a fresh install with no
active jobs and no chat traffic:

| Process              | Idle RSS | Under load (heavy import) |
| -------------------- | -------- | ------------------------- |
| `mnela-api`          | < 200 MB | < 350 MB                  |
| `mnela-web`          | < 120 MB | < 180 MB                  |
| `mnela-orchestrator` | < 250 MB | < 400 MB                  |
| `mnela-worker`       | < 180 MB | < 300 MB                  |
| `mnela-tg-bot`       | < 100 MB | < 140 MB                  |
| `mnela-mcp`          | < 100 MB | < 130 MB                  |
| `mnela-postgres`     | < 250 MB | grows with shared_buffers |
| `mnela-redis`        | < 60 MB  | < 120 MB                  |
| `mnela-caddy`        | < 30 MB  | < 50 MB                   |

A 1 GB VPS leaves ~150 MB headroom under load. If a process exceeds
its "under load" budget for more than a few minutes — start looking.

Per-process container limits in `infra/docker/docker-compose.yml`
`mem_limit:` give Docker permission to OOM-kill a runaway. They are
ceiling, not target — the targets above are tighter.

## Inspect what's running

```bash
docker stats --no-stream
mnela status               # container + Claude-test snapshot
mnela logs api 200         # tail logs
```

## Postgres slow-query audit

`pg_stat_statements` is preloaded in the compose `postgres` service
(`shared_preload_libraries=pg_stat_statements`, see compose `command:`).
The first time you upgrade to this version postgres needs a
container restart — `mnela update` handles that for you, or run
`docker compose up -d postgres` after `git pull`.

Enable the extension and snapshot the audit:

```bash
mnela db:audit
```

That command:

1. Runs `CREATE EXTENSION IF NOT EXISTS pg_stat_statements` (idempotent).
2. Prints the **top 20 queries** by total exec time
   (`SELECT … FROM pg_stat_statements ORDER BY total_exec_time DESC`).
3. Prints **unused indexes** (`pg_stat_user_indexes` with `idx_scan = 0`,
   non-unique, non-primary) so you can see what to drop.
4. Prints **tables with bad seq/idx ratios** from `pg_stat_user_tables`
   for tables larger than 10k rows.

Reset the counters before a fresh measurement window:

```bash
docker compose exec postgres \
  psql -U mnela -d mnela -c "SELECT pg_stat_statements_reset();"
```

For a single suspect query, get a real plan with cache state included:

```bash
docker compose exec postgres \
  psql -U mnela -d mnela -c "EXPLAIN (ANALYZE, BUFFERS) SELECT … ;"
```

## Node-side flame graphs

`clinic` is the easiest path on Linux:

```bash
# inside the api container (or against the dev pnpm process):
npx --yes clinic flame -- node dist/main.js
# … exercise the workload …
# Ctrl+C — clinic writes an HTML flame graph to ./.clinic/<pid>.flamegraph.html
```

For BullMQ consumers (`apps/worker`, `apps/orchestrator`):

```bash
NODE_OPTIONS="--inspect=0.0.0.0:9229" pnpm --filter @mnela/worker dev
# in Chrome: chrome://inspect → Open dedicated DevTools for Node
# → CPU profiler → record 30s during ingest
```

The orchestrator's enrichment loop spends most of its time in the
`claude` CLI subprocess — the Node profile will be dominated by
`spawn`/IO wait. Focus on whatever sits between two `tool_result`
frames instead.

## Where to look first when latency creeps up

- **Cmd-K palette is sluggish** → look at `/search` hybrid mode in
  `pg_stat_statements`. The trigram + tsvector path can blow up when
  `Document` grows past 100k rows without `pg_trgm.gin_trgm_ops`
  index coverage.
- **/ask first-token > 2 s** → orchestrator pool size
  (`enrichment.parallelism`) is too high and the CLI is queueing.
  Drop the value in `/admin/system` and Restart Services.
- **Graph hover lag** → too many edges in viewport; the renderer
  capped at ~5k visible. Add a tighter type filter or a `confidence`
  floor in the URL params.
- **Worker RSS climbs and stays** → almost always the gpt-tokenizer
  cache or a parser that didn't stream. Open `/activity?tab=queue`,
  expand Stats — outlier durations point at the parser.

## Reporting an incident

Attach to the GitHub issue:

- `docker stats --no-stream` snapshot at the time of the symptom
- `mnela db:audit` output
- 30 s of `docker compose logs --since 30s` for the suspect service

That tuple is usually enough to root-cause.
